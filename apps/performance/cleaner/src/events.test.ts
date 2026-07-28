import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  decodeCloudWatchRecord,
  histogramBucket,
  minuteBucket,
  parseCloudWatchRecord,
} from "./events.js";

const valid = {
  schema: "customer-ops.performance.v1",
  eventId: "a".repeat(32), occurredAt: "2026-07-28T12:34:56.000Z",
  service: "model-server", environment: "production", release: "abc",
  eventType: "span", operation: "model.chat", status: "ok",
  traceId: "b".repeat(32), spanId: "c".repeat(16), parentSpanId: null,
  durationMs: 42, sampled: true, measurements: { ttftMs: 20 },
  attributes: { model: "customer-ops" },
};

test("decodes, validates and sanitizes CloudWatch records", () => {
  const payload = gzipSync(JSON.stringify({
    messageType: "DATA_MESSAGE",
    logEvents: [{ message: JSON.stringify({
      ...valid,
      secret: "must disappear",
      attributes: { endpoint: "/v1/chat?token=secret" },
    }) }],
  }));
  const [event] = parseCloudWatchRecord(payload);
  assert.equal(event.operation, "model.chat");
  assert.equal((event as unknown as Record<string, unknown>).secret, undefined);
  assert.equal(event.attributes.endpoint, "/v1/chat");
});

test("counts invalid events without retaining their payload", () => {
  const payload = gzipSync(JSON.stringify({
    messageType: "DATA_MESSAGE",
    logEvents: [
      { message: JSON.stringify(valid) },
      { message: JSON.stringify({ ...valid, service: "../../unsafe" }) },
      { message: "not-json" },
    ],
  }));
  const decoded = decodeCloudWatchRecord(payload);
  assert.equal(decoded.events.length, 1);
  assert.equal(decoded.invalidCount, 2);
});

test("uses stable minute and histogram buckets", () => {
  assert.equal(minuteBucket(valid.occurredAt), "2026-07-28T12:34:00.000Z");
  assert.equal(histogramBucket(42), "b5");
});
