use serde::Serialize;
use serde_json::{Map, Value};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};
use uuid::Uuid;

pub const SCHEMA: &str = "customer-ops.performance.v1";
const MEASUREMENT_KEYS: &[&str] = &[
    "count",
    "queueMs",
    "ttftMs",
    "tokensPerSecond",
    "inputTokens",
    "outputTokens",
    "batchSize",
    "gpuUtilizationPercent",
    "gpuMemoryUsedBytes",
    "gpuMemoryTotalBytes",
    "gpuTemperatureCelsius",
    "gpuPowerWatts",
    "cpuPercent",
    "rssBytes",
    "lcpMs",
    "inpMs",
    "cls",
    "ttfbMs",
    "prefetchMs",
    "renderMs",
    "totalMs",
];
const ATTRIBUTE_KEYS: &[&str] = &[
    "component",
    "endpoint",
    "httpMethod",
    "httpStatusCode",
    "model",
    "finishReason",
    "errorType",
    "errorCode",
    "errorFingerprint",
    "route",
    "runtime",
    "gpuName",
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TraceContext {
    pub trace_id: String,
    pub span_id: String,
    pub sampled: bool,
}

pub fn parse_traceparent(value: &str) -> Option<TraceContext> {
    let parts: Vec<_> = value.trim().split('-').collect();
    if parts.len() != 4 || parts[0] != "00" || parts[1].len() != 32 || parts[2].len() != 16 {
        return None;
    }
    if !parts[1]
        .chars()
        .chain(parts[2].chars())
        .all(|c| c.is_ascii_hexdigit())
    {
        return None;
    }
    let sampled = match parts[3] {
        "01" => true,
        "00" => false,
        _ => return None,
    };
    Some(TraceContext {
        trace_id: parts[1].into(),
        span_id: parts[2].into(),
        sampled,
    })
}

pub fn format_traceparent(context: &TraceContext) -> String {
    format!(
        "00-{}-{}-{}",
        context.trace_id,
        context.span_id,
        if context.sampled { "01" } else { "00" }
    )
}

#[derive(Clone)]
pub struct PerformanceClient {
    inner: Arc<Inner>,
}

struct Inner {
    service: String,
    environment: String,
    release: String,
    sample_rate: f64,
    slow_threshold: Duration,
    sender: mpsc::SyncSender<WorkerMessage>,
}

enum WorkerMessage {
    Event(Event),
    Flush(mpsc::SyncSender<()>),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Event {
    schema: &'static str,
    event_id: String,
    occurred_at: String,
    service: String,
    environment: String,
    release: String,
    event_type: String,
    operation: String,
    status: String,
    trace_id: String,
    span_id: String,
    parent_span_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration_ms: Option<f64>,
    sampled: bool,
    measurements: Map<String, Value>,
    attributes: Map<String, Value>,
}

impl PerformanceClient {
    pub fn new(
        service: impl Into<String>,
        environment: impl Into<String>,
        release: impl Into<String>,
    ) -> Self {
        Self::with_sink(
            service,
            environment,
            release,
            0.1,
            Duration::from_secs(2),
            500,
            |line| println!("{line}"),
        )
    }

    pub fn with_sink<F>(
        service: impl Into<String>,
        environment: impl Into<String>,
        release: impl Into<String>,
        sample_rate: f64,
        slow_threshold: Duration,
        capacity: usize,
        sink: F,
    ) -> Self
    where
        F: Fn(String) + Send + 'static,
    {
        let (sender, receiver) = mpsc::sync_channel::<WorkerMessage>(capacity.max(1));
        std::thread::Builder::new()
            .name("performance-sdk".into())
            .spawn(move || {
                while let Ok(message) = receiver.recv() {
                    match message {
                        WorkerMessage::Event(event) => {
                            if let Ok(line) = serde_json::to_string(&event) {
                                sink(line);
                            }
                        }
                        WorkerMessage::Flush(acknowledge) => {
                            let _ = acknowledge.try_send(());
                        }
                    }
                }
            })
            .ok();
        Self {
            inner: Arc::new(Inner {
                service: service.into(),
                environment: environment.into(),
                release: release.into(),
                sample_rate: sample_rate.clamp(0.0, 1.0),
                slow_threshold,
                sender,
            }),
        }
    }

    pub fn start_span(
        &self,
        operation: impl Into<String>,
        parent: Option<&TraceContext>,
    ) -> PerformanceSpan {
        let sampled = parent.map(|p| p.sampled).unwrap_or_else(|| {
            let value = u64::from_le_bytes(Uuid::new_v4().as_bytes()[..8].try_into().unwrap());
            (value as f64 / u64::MAX as f64) < self.inner.sample_rate
        });
        let context = TraceContext {
            trace_id: parent.map(|p| p.trace_id.clone()).unwrap_or_else(id32),
            span_id: id16(),
            sampled,
        };
        PerformanceSpan {
            client: self.clone(),
            operation: operation.into(),
            context,
            parent_span_id: parent.map(|p| p.span_id.clone()),
            started: Instant::now(),
            finished: false,
            measurements: Map::new(),
            attributes: Map::new(),
        }
    }

    pub fn record_metric(&self, operation: impl Into<String>, measurements: Map<String, Value>) {
        self.send(self.event(
            "metric",
            operation.into(),
            "ok",
            TraceContext {
                trace_id: id32(),
                span_id: id16(),
                sampled: true,
            },
            None,
            None,
            measurements,
            Map::new(),
        ));
    }

    pub fn capture_error(
        &self,
        operation: impl Into<String>,
        error_type: &str,
        code: Option<&str>,
        context: Option<&TraceContext>,
    ) {
        let mut attributes = Map::new();
        attributes.insert(
            "errorType".into(),
            Value::String(error_type.chars().take(96).collect()),
        );
        if let Some(code) = code {
            attributes.insert(
                "errorCode".into(),
                Value::String(code.chars().take(64).collect()),
            );
        }
        let parent_span_id = context.map(|value| value.span_id.clone());
        let context = TraceContext {
            trace_id: context
                .map(|value| value.trace_id.clone())
                .unwrap_or_else(id32),
            span_id: id16(),
            sampled: true,
        };
        self.send(self.event(
            "error",
            operation.into(),
            "error",
            context,
            parent_span_id,
            None,
            Map::new(),
            attributes,
        ));
    }

    pub fn flush(&self) {
        let (acknowledge, completed) = mpsc::sync_channel(1);
        if self
            .inner
            .sender
            .send(WorkerMessage::Flush(acknowledge))
            .is_ok()
        {
            let _ = completed.recv_timeout(Duration::from_secs(1));
        }
    }

    fn finish(&self, span: &PerformanceSpan, status: &str) {
        let duration = span.started.elapsed();
        if !span.context.sampled && status == "ok" && duration < self.inner.slow_threshold {
            return;
        }
        self.send(self.event(
            "span",
            span.operation.clone(),
            status,
            span.context.clone(),
            span.parent_span_id.clone(),
            Some(duration.as_secs_f64() * 1000.0),
            span.measurements.clone(),
            span.attributes.clone(),
        ));
    }

    fn event(
        &self,
        kind: &str,
        operation: String,
        status: &str,
        context: TraceContext,
        parent: Option<String>,
        duration_ms: Option<f64>,
        mut measurements: Map<String, Value>,
        mut attributes: Map<String, Value>,
    ) -> Event {
        measurements.retain(|key, value| {
            MEASUREMENT_KEYS.contains(&key.as_str()) && value.as_f64().is_some_and(f64::is_finite)
        });
        attributes.retain(|key, value| {
            ATTRIBUTE_KEYS.contains(&key.as_str())
                && match value {
                    Value::String(text) => {
                        if matches!(key.as_str(), "endpoint" | "route") {
                            text.truncate(text.find('?').unwrap_or(text.len()));
                        }
                        if text.len() > 96 {
                            text.truncate(96);
                        }
                        true
                    }
                    Value::Number(number) => number.as_f64().is_some_and(f64::is_finite),
                    _ => false,
                }
        });
        Event {
            schema: SCHEMA,
            event_id: id32(),
            occurred_at: now_iso8601(),
            service: self.inner.service.clone(),
            environment: self.inner.environment.clone(),
            release: self.inner.release.clone(),
            event_type: kind.into(),
            operation,
            status: status.into(),
            trace_id: context.trace_id,
            span_id: context.span_id,
            parent_span_id: parent,
            duration_ms,
            sampled: context.sampled || status != "ok",
            measurements,
            attributes,
        }
    }

    fn send(&self, event: Event) {
        let _ = self.inner.sender.try_send(WorkerMessage::Event(event));
    }
}

pub struct PerformanceSpan {
    client: PerformanceClient,
    operation: String,
    pub context: TraceContext,
    parent_span_id: Option<String>,
    started: Instant,
    finished: bool,
    pub measurements: Map<String, Value>,
    pub attributes: Map<String, Value>,
}

impl PerformanceSpan {
    pub fn finish(mut self, status: &str) {
        if !self.finished {
            self.client.finish(&self, status);
            self.finished = true;
        }
    }
}

impl Drop for PerformanceSpan {
    fn drop(&mut self) {
        if !self.finished {
            self.client.finish(self, "unknown");
            self.finished = true;
        }
    }
}

fn id32() -> String {
    Uuid::new_v4().simple().to_string()
}
fn id16() -> String {
    id32()[..16].to_string()
}
fn now_iso8601() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    #[test]
    fn traceparent_round_trip() {
        let context = TraceContext {
            trace_id: "a".repeat(32),
            span_id: "b".repeat(16),
            sampled: true,
        };
        assert_eq!(
            parse_traceparent(&format_traceparent(&context)),
            Some(context)
        );
    }

    #[test]
    fn sanitizes_maps_and_flushes() {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let output = lines.clone();
        let client = PerformanceClient::with_sink(
            "backend",
            "test",
            "test",
            1.0,
            Duration::from_secs(2),
            10,
            move |line| output.lock().unwrap().push(line),
        );
        let mut measurements = Map::new();
        measurements.insert("queueMs".into(), Value::from(12));
        measurements.insert("userId".into(), Value::from(42));
        client.record_metric("http.request", measurements);
        client.flush();
        let event: Value = serde_json::from_str(&lines.lock().unwrap()[0]).unwrap();
        assert_eq!(event["measurements"], serde_json::json!({"queueMs": 12}));
    }

    #[test]
    fn start_finish_p95_overhead_is_below_one_millisecond() {
        let client = PerformanceClient::with_sink(
            "backend",
            "test",
            "test",
            0.1,
            Duration::from_secs(2),
            1,
            |_| {},
        );
        let mut durations = (0..5_000)
            .map(|_| {
                let started = Instant::now();
                client.start_span("benchmark.request", None).finish("ok");
                started.elapsed()
            })
            .collect::<Vec<_>>();
        durations.sort_unstable();
        assert!(durations[durations.len() * 95 / 100] < Duration::from_millis(1));
    }
}
