import assert from "node:assert/strict";
import test from "node:test";
import { buildEnvelopes, isFailure, parseDsn, toSentryEvent } from "./event-to-sentry.mjs";

const base = {
  schema: "customer-ops.performance.v1",
  eventId: "a".repeat(32),
  occurredAt: "2026-07-28T12:34:56.000Z",
  service: "model-api",
  environment: "production",
  release: "2026.07.28",
  eventType: "error",
  operation: "model.generate",
  status: "error",
  traceId: "b".repeat(32),
  spanId: "c".repeat(16),
  parentSpanId: null,
  durationMs: 30_000,
  sampled: true,
  measurements: { ttftMs: 6_200 },
  attributes: { errorType: "ModelServerTimeout", errorFingerprint: "fp-timeout", endpoint: "/api/chat" },
};

test("parses a DSN into the envelope endpoint", () => {
  const parsed = parseDsn("http://abc123@127.0.0.1:9000/1");
  assert.equal(parsed.key, "abc123");
  assert.equal(parsed.projectId, "1");
  assert.equal(parsed.envelopeUrl, "http://127.0.0.1:9000/api/1/envelope/");
});

test("rejects a malformed DSN instead of posting to a wrong URL", () => {
  assert.throws(() => parseDsn("http://127.0.0.1:9000/1"), /SENTRY_DSN/);
});

test("treats error events and non-ok spans as failures, plain spans as context", () => {
  assert.equal(isFailure(base), true);
  assert.equal(isFailure({ ...base, eventType: "span", status: "timeout" }), true);
  assert.equal(isFailure({ ...base, eventType: "span", status: "ok" }), false);
});

test("maps an error event onto Sentry issue fields", () => {
  const sentry = toSentryEvent(base, [], "production");
  assert.equal(sentry.event_id, base.eventId, "复用 eventId 让 Sentry 能去重");
  assert.equal(sentry.exception.values[0].type, "ModelServerTimeout");
  assert.deepEqual(sentry.fingerprint, ["fp-timeout"]);
  assert.equal(sentry.tags.service, "model-api", "service 进 tag 才能在 Sentry 里分服务看");
  assert.equal(sentry.tags.errorType, "ModelServerTimeout");
  assert.equal(sentry.contexts.trace.trace_id, base.traceId);
  assert.equal(sentry.extra.endpoint, "/api/chat", "高基数字段留在 extra，不做成 tag");
  assert.equal(sentry.tags.endpoint, undefined);
  assert.equal(sentry.extra.errorFingerprint, undefined, "指纹已用作 fingerprint，不重复放 extra");
});

test("falls back to a derived fingerprint when the SDK did not supply one", () => {
  const { attributes, ...rest } = base;
  const sentry = toSentryEvent(
    { ...rest, attributes: { errorType: "BackendUnavailable" } }, [], "production",
  );
  assert.deepEqual(sentry.fingerprint, ["model-api:model.generate:BackendUnavailable"]);
});

test("attaches preceding same-trace spans as breadcrumbs", () => {
  const spans = [
    { ...base, eventId: "1".repeat(32), eventType: "span", status: "ok",
      operation: "api.request", service: "browser", occurredAt: "2026-07-28T12:34:50.000Z", durationMs: 12 },
    { ...base, eventId: "2".repeat(32), eventType: "span", status: "ok",
      operation: "order.fetch", service: "backend", occurredAt: "2026-07-28T12:34:54.000Z", durationMs: 30 },
    // 错误之后发生的 span 不该出现在面包屑里
    { ...base, eventId: "3".repeat(32), eventType: "span", status: "ok",
      operation: "later.span", service: "backend", occurredAt: "2026-07-28T12:35:10.000Z" },
  ];
  const values = toSentryEvent(base, spans, "production").breadcrumbs.values;
  assert.deepEqual(values.map((crumb) => crumb.message), [
    "api.request ok", "order.fetch ok",
  ]);
  assert.equal(values[0].data.service, "browser");
});

const envelopeOptions = {
  dsn: "http://abc123@127.0.0.1:9000/1",
  environment: "production",
  sentAt: "2026-07-28T12:35:00.000Z",
};

test("builds one envelope per failure with a matching header event_id", () => {
  const [envelope] = buildEnvelopes([base], envelopeOptions);
  const lines = envelope.body.trimEnd().split("\n");
  assert.equal(lines.length, 3);
  const header = JSON.parse(lines[0]);
  assert.equal(header.dsn, envelopeOptions.dsn);
  // header 的 event_id 必须与 item 一致，否则 Sentry 会丢弃该 event
  assert.equal(header.event_id, base.eventId);
  assert.equal(JSON.parse(lines[1]).type, "event");
  assert.equal(JSON.parse(lines[1]).length, Buffer.byteLength(lines[2]));
  assert.equal(JSON.parse(lines[2]).event_id, base.eventId);
});

test("never packs two failures into one envelope", () => {
  const second = { ...base, eventId: "9".repeat(32), operation: "model.chat" };
  const envelopes = buildEnvelopes([base, second], envelopeOptions);
  // 实测：一个 envelope 里放两个 event item，Sentry 只入库一个，其余静默丢弃。
  assert.equal(envelopes.length, 2);
  assert.deepEqual(envelopes.map((item) => item.eventId), [base.eventId, second.eventId]);
  for (const envelope of envelopes) {
    assert.equal(envelope.body.trimEnd().split("\n").length, 3);
  }
});

test("returns no envelopes when a batch holds no failures so sync can skip the request", () => {
  const healthy = { ...base, eventType: "span", status: "ok" };
  assert.deepEqual(buildEnvelopes([healthy], envelopeOptions), []);
});
