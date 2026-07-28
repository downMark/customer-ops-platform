import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { EventProcessor } from "./processor.js";
import type { PerformanceEvent } from "./events.js";

const event: PerformanceEvent = {
  schema: "customer-ops.performance.v1",
  eventId: "a".repeat(32),
  occurredAt: "2026-07-28T12:34:56.000Z",
  service: "model-server",
  environment: "production",
  release: "release-a",
  eventType: "span",
  operation: "model.chat",
  status: "ok",
  traceId: "b".repeat(32),
  spanId: "c".repeat(16),
  parentSpanId: null,
  durationMs: 42,
  sampled: true,
  measurements: { ttftMs: 20 },
  attributes: { model: "customer-ops" },
};

test("deduplicates event IDs and writes release-aware aggregate plus gzip detail", async () => {
  const claims = new Set<string>();
  const updates: Array<Record<string, unknown>> = [];
  const objects: Array<Record<string, unknown>> = [];
  const dynamo = {
    async send(command: { input: Record<string, unknown> }) {
      if ("ConditionExpression" in command.input) {
        const id = String((command.input.Item as Record<string, unknown>).pk);
        if (claims.has(id)) {
          const error = new Error("duplicate");
          error.name = "ConditionalCheckFailedException";
          throw error;
        }
        claims.add(id);
      } else {
        updates.push(command.input);
      }
      return {};
    },
  };
  const s3 = {
    async send(command: { input: Record<string, unknown> }) {
      objects.push(command.input);
      return {};
    },
  };
  const processor = new EventProcessor(dynamo as never, s3 as never, {
    stateTable: "state",
    aggregateTable: "aggregate",
    detailBucket: "detail",
    retentionDays: 30,
  });

  assert.equal(await processor.process([event]), 1);
  assert.equal(await processor.process([event]), 0);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].Key, {
    pk: "production#model-server#release-a#model.chat#span",
    sk: "2026-07-28T12:34:00.000Z",
  });
  assert.equal(
    (updates[0].ExpressionAttributeNames as Record<string, string>)["#bucket"],
    "histogram_b5",
  );
  assert.equal(objects.length, 1);
  assert.match(String(objects[0].Key), /service=model-server/);
  const detail = gunzipSync(objects[0].Body as Uint8Array).toString("utf8");
  assert.equal(JSON.parse(detail).eventId, event.eventId);
});

test("keeps metric events in aggregates but not S3 detail", async () => {
  let objectWrites = 0;
  const dynamo = { send: async () => ({}) };
  const s3 = { send: async () => { objectWrites += 1; return {}; } };
  const processor = new EventProcessor(dynamo as never, s3 as never, {
    stateTable: "state",
    aggregateTable: "aggregate",
    detailBucket: "detail",
    retentionDays: 30,
  });
  assert.equal(await processor.process([{
    ...event,
    eventId: "d".repeat(32),
    eventType: "metric",
  }]), 1);
  assert.equal(objectWrites, 0);
});
