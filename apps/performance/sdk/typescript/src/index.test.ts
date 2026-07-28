import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTraceparent,
  parseTraceparent,
  PerformanceClient,
  type PerformanceEventV1,
} from "./index.js";

test("formats and parses W3C trace context", () => {
  const context = { traceId: "a".repeat(32), spanId: "b".repeat(16), sampled: true };
  assert.deepEqual(parseTraceparent(formatTraceparent(context)), context);
});

test("keeps metrics and forces error spans while normal spans are sampled", async () => {
  const events: unknown[] = [];
  const client = new PerformanceClient({
    service: "model-api", sampleRate: 0, slowThresholdMs: 60_000,
    sink: (batch) => { events.push(...batch); },
  });
  client.startSpan("http.normal").finish();
  client.startSpan("http.failed").finish("error");
  client.recordMetric("runtime.memory", { rssBytes: 1024 });
  await client.close();
  assert.equal(events.length, 2);
  assert.equal((events[0] as { status: string }).status, "error");
});

test("drops non-whitelisted fields and URL queries before logging", async () => {
  const events: PerformanceEventV1[] = [];
  const client = new PerformanceClient({
    service: "browser",
    sink: (batch) => { events.push(...batch); },
  });
  client.recordMetric(
    "browser.request",
    { ttfbMs: 20, userId: 42 } as never,
    { endpoint: "/api/orders?token=secret", orderId: "secret" } as never,
  );
  await client.close();
  assert.deepEqual(events[0].measurements, { ttfbMs: 20 });
  assert.deepEqual(events[0].attributes, { endpoint: "/api/orders" });
});

test("keeps start/finish p95 overhead below one millisecond", async () => {
  const client = new PerformanceClient({
    service: "model-api",
    sampleRate: 0.1,
    maxQueueSize: 1,
    sink: () => {},
  });
  const durations = Array.from({ length: 5_000 }, () => {
    const started = performance.now();
    client.startSpan("benchmark.request").finish();
    return performance.now() - started;
  }).sort((left, right) => left - right);
  await client.close();
  assert.ok(durations[Math.floor(durations.length * 0.95)] < 1);
});
