// 把 customer-ops.performance.v1 事件转成 Sentry envelope。
//
// 为什么不是 OTLP：Sentry 26.5.1 自托管没有 OTLP 摄入路由
// （/api/0/integration/otlp/v1/traces 与 relay 的 /api/{id}/otlp/v1/traces 均 404），
// 而且 OTLP trace 会落到 span/transaction 管道——errors-only profile 已经把
// 那条管道整个砍掉了。envelope 走 error 管道，直接产出 issue，在 errors-only 下原生可用。

const BREADCRUMB_LIMIT = 20;
// tag 是索引字段，高基数会拖垮 Sentry 的搜索；只放低基数的维度，其余进 extra。
const TAG_ATTRIBUTES = ["errorType", "errorCode", "component", "runtime"];

export function parseDsn(dsn) {
  const url = new URL(dsn);
  const projectId = url.pathname.replace(/^\//, "");
  if (!url.username || !projectId) {
    throw new Error("SENTRY_DSN must look like http://<key>@<host>/<projectId>");
  }
  return {
    key: url.username,
    projectId,
    envelopeUrl: `${url.origin}/api/${projectId}/envelope/`,
  };
}

// 只有 error 事件和非 ok 的 span 才值得变成 issue；正常 span 留作面包屑上下文。
export function isFailure(event) {
  return event.eventType === "error" || event.status !== "ok";
}

// 一个 envelope 只能承载一个 event item：envelope header 带的是单个 event_id，
// 多个 event 塞进同一个 envelope 时 Sentry 只会收下其中一个，其余静默丢弃
// （实测发 2 条失败只入库 1 条）。所以按失败事件逐个产出 envelope。
export function buildEnvelopes(events, { dsn, environment, sentAt }) {
  const spansByTrace = new Map();
  for (const event of events) {
    if (isFailure(event)) continue;
    const group = spansByTrace.get(event.traceId);
    if (group) group.push(event);
    else spansByTrace.set(event.traceId, [event]);
  }

  return events.filter(isFailure).map((event) => {
    const payload = toSentryEvent(event, spansByTrace.get(event.traceId) ?? [], environment);
    const body = JSON.stringify(payload);
    const header = JSON.stringify({ event_id: payload.event_id, sent_at: sentAt, dsn });
    const itemHeader = JSON.stringify({
      type: "event",
      content_type: "application/json",
      length: Buffer.byteLength(body),
    });
    return { eventId: payload.event_id, body: `${header}\n${itemHeader}\n${body}\n` };
  });
}

export function toSentryEvent(event, siblingSpans, environment) {
  const errorType = event.attributes?.errorType || "PerformanceError";
  const level = event.status === "cancelled" ? "warning" : "error";

  const tags = {
    service: event.service,
    operation: event.operation,
    status: event.status,
    event_type: event.eventType,
  };
  const extra = { ...event.measurements };
  for (const [key, value] of Object.entries(event.attributes ?? {})) {
    if (key === "errorFingerprint") continue;
    if (TAG_ATTRIBUTES.includes(key)) tags[key] = String(value);
    else extra[key] = value;
  }

  return {
    // 复用上游 eventId：Sentry 按 event_id 去重，重投递同一批不会产生重复 issue。
    event_id: event.eventId,
    timestamp: event.occurredAt,
    platform: "other",
    level,
    logger: "customer-ops.performance",
    release: event.release,
    environment: event.environment || environment,
    transaction: event.operation,
    // 优先用 SDK 算好的稳定指纹，保证同一类错误聚成一个 issue。
    fingerprint: [event.attributes?.errorFingerprint
      || `${event.service}:${event.operation}:${errorType}`],
    tags,
    extra,
    contexts: {
      trace: {
        trace_id: event.traceId,
        span_id: event.spanId,
        ...(event.parentSpanId ? { parent_span_id: event.parentSpanId } : {}),
        op: event.operation,
        status: event.status,
      },
    },
    exception: {
      values: [{
        type: errorType,
        value: `${event.operation} ${event.status}`,
        mechanism: { type: "customer-ops-performance", handled: true },
      }],
    },
    breadcrumbs: { values: toBreadcrumbs(siblingSpans, event.occurredAt) },
  };
}

// 同一条 trace 上、发生在错误之前的 span，作为面包屑挂上去。
// 这样在 Sentry 里点开 issue 就能看到导致它的请求链路，而不必把访问日志灌进 Sentry。
function toBreadcrumbs(spans, until) {
  const deadline = Date.parse(until);
  return spans
    .filter((span) => Date.parse(span.occurredAt) <= deadline)
    .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt))
    .slice(-BREADCRUMB_LIMIT)
    .map((span) => ({
      timestamp: span.occurredAt,
      type: "default",
      category: `${span.service}.${span.eventType}`,
      level: span.status === "ok" ? "info" : "warning",
      message: `${span.operation} ${span.status}`,
      data: {
        service: span.service,
        span_id: span.spanId,
        ...(span.durationMs === undefined ? {} : { duration_ms: span.durationMs }),
      },
    }));
}
