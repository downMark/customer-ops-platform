from __future__ import annotations

import json
import random
import re
import secrets
import sys
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from queue import Empty, Full, Queue
from typing import Any, Callable

SCHEMA = "customer-ops.performance.v1"
TRACEPARENT = re.compile(r"^00-([0-9a-f]{32})-([0-9a-f]{16})-(0[01])$")
MEASUREMENT_KEYS = {
    "count", "queueMs", "ttftMs", "tokensPerSecond", "inputTokens",
    "outputTokens", "batchSize", "gpuUtilizationPercent",
    "gpuMemoryUsedBytes", "gpuMemoryTotalBytes", "gpuTemperatureCelsius",
    "gpuPowerWatts", "cpuPercent", "rssBytes", "lcpMs", "inpMs", "cls",
    "ttfbMs", "prefetchMs", "renderMs", "totalMs",
}
ATTRIBUTE_KEYS = {
    "component", "endpoint", "httpMethod", "httpStatusCode", "model",
    "finishReason", "errorType", "errorCode", "errorFingerprint", "route",
    "runtime", "gpuName",
}


@dataclass(frozen=True)
class TraceContext:
    trace_id: str
    span_id: str
    sampled: bool


def parse_traceparent(value: str | None) -> TraceContext | None:
    match = TRACEPARENT.fullmatch((value or "").strip())
    if not match:
        return None
    return TraceContext(match[1], match[2], match[3] == "01")


def format_traceparent(context: TraceContext) -> str:
    return f"00-{context.trace_id}-{context.span_id}-{'01' if context.sampled else '00'}"


class PerformanceClient:
    def __init__(
        self,
        service: str,
        environment: str = "local",
        release: str = "development",
        sample_rate: float = 0.1,
        slow_threshold_ms: float = 2_000,
        max_queue_size: int = 500,
        sink: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self.service = service
        self.environment = re.sub(r"[^a-z0-9_-]", "-", environment.lower())[:32] or "unknown"
        self.release = release[:128]
        self.sample_rate = max(0.0, min(1.0, sample_rate))
        self.slow_threshold_ms = max(0.0, slow_threshold_ms)
        self._queue: Queue[dict[str, Any] | None] = Queue(maxsize=max(1, max_queue_size))
        self._sink = sink or (lambda event: print(json.dumps(event, separators=(",", ":")), flush=True))
        self._worker: threading.Thread | None = threading.Thread(
            target=self._drain,
            name="performance-sdk",
            daemon=True,
        )
        try:
            self._worker.start()
        except RuntimeError:
            self._worker = None

    def start_span(
        self,
        operation: str,
        parent: TraceContext | None = None,
        attributes: dict[str, Any] | None = None,
        measurements: dict[str, float] | None = None,
    ) -> PerformanceSpan:
        sampled = parent.sampled if parent else random.random() < self.sample_rate
        context = TraceContext(parent.trace_id if parent else secrets.token_hex(16), secrets.token_hex(8), sampled)
        return PerformanceSpan(self, operation, context, parent.span_id if parent else None, attributes or {}, measurements or {})

    def record_metric(self, operation: str, measurements: dict[str, float], attributes: dict[str, Any] | None = None) -> None:
        self._emit(self._event("metric", operation, "ok", TraceContext(secrets.token_hex(16), secrets.token_hex(8), True), None, None, measurements, attributes or {}))

    def capture_error(self, operation: str, error: BaseException, context: TraceContext | None = None, code: str | None = None) -> None:
        parent_span_id = context.span_id if context else None
        error_context = TraceContext(
            context.trace_id if context else secrets.token_hex(16),
            secrets.token_hex(8),
            True,
        )
        self._emit(self._event("error", operation, "error", error_context, parent_span_id, None, {}, {
            "errorType": type(error).__name__[:96],
            **({"errorCode": code[:64]} if code else {}),
        }))

    def _finish_span(self, operation: str, context: TraceContext, parent_span_id: str | None, duration_ms: float, status: str, measurements: dict[str, float], attributes: dict[str, Any]) -> None:
        if not context.sampled and status == "ok" and duration_ms < self.slow_threshold_ms:
            return
        self._emit(self._event("span", operation, status, context, parent_span_id, duration_ms, measurements, attributes))

    def _event(self, event_type: str, operation: str, status: str, context: TraceContext, parent_span_id: str | None, duration_ms: float | None, measurements: dict[str, float], attributes: dict[str, Any]) -> dict[str, Any]:
        safe_measurements = {
            key: value for key, value in measurements.items()
            if key in MEASUREMENT_KEYS
            and isinstance(value, (int, float))
            and not isinstance(value, bool)
            and float("-inf") < float(value) < float("inf")
        }
        safe_attributes: dict[str, str | int | float] = {}
        for key, value in attributes.items():
            if key not in ATTRIBUTE_KEYS or isinstance(value, bool):
                continue
            if isinstance(value, str):
                safe_attributes[key] = (
                    value.split("?", 1)[0] if key in {"endpoint", "route"} else value
                )[:96]
            elif isinstance(value, (int, float)) and float("-inf") < float(value) < float("inf"):
                safe_attributes[key] = value
        event = {
            "schema": SCHEMA, "eventId": secrets.token_hex(16),
            "occurredAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "service": self.service, "environment": self.environment, "release": self.release,
            "eventType": event_type, "operation": operation, "status": status,
            "traceId": context.trace_id, "spanId": context.span_id,
            "parentSpanId": parent_span_id, "sampled": context.sampled or status != "ok",
            "measurements": safe_measurements, "attributes": safe_attributes,
        }
        if duration_ms is not None:
            event["durationMs"] = max(0.0, duration_ms)
        return event

    def _emit(self, event: dict[str, Any]) -> None:
        try:
            self._queue.put_nowait(event)
        except Full:
            pass

    def flush(self, timeout: float = 1.0) -> None:
        if self._worker is None:
            return
        deadline = time.monotonic() + timeout
        while self._queue.unfinished_tasks and time.monotonic() < deadline:
            time.sleep(0.005)

    def close(self) -> None:
        self.flush()
        try:
            self._queue.put_nowait(None)
        except Full:
            return
        if self._worker is not None:
            self._worker.join(timeout=1)

    def _drain(self) -> None:
        while True:
            try:
                event = self._queue.get(timeout=0.5)
            except Empty:
                continue
            try:
                if event is None:
                    return
                self._sink(event)
            except Exception:
                print("performance sink dropped an event", file=sys.stderr)
            finally:
                self._queue.task_done()


class PerformanceSpan:
    def __init__(self, client: PerformanceClient, operation: str, context: TraceContext, parent_span_id: str | None, attributes: dict[str, Any], measurements: dict[str, float]) -> None:
        self.client, self.operation, self.context = client, operation, context
        self.parent_span_id, self.attributes, self.measurements = parent_span_id, attributes, measurements
        self.started = time.perf_counter()
        self.finished = False

    def finish(self, status: str = "ok", measurements: dict[str, float] | None = None) -> None:
        if self.finished:
            return
        self.finished = True
        duration_ms = (time.perf_counter() - self.started) * 1000
        self.client._finish_span(self.operation, self.context, self.parent_span_id, duration_ms, status, {**self.measurements, **(measurements or {})}, self.attributes)

    def __enter__(self) -> PerformanceSpan:
        return self

    def __exit__(self, exc_type: Any, exc: BaseException | None, traceback: Any) -> None:
        self.finish("error" if exc else "ok")
        if exc:
            self.client.capture_error(self.operation, exc, self.context)
