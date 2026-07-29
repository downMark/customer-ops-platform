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

test("splits one batch across hour partitions instead of filing it under the first event", async () => {
  const objects: Array<Record<string, unknown>> = [];
  const dynamo = { send: async () => ({}) };
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

  // 同一批里跨越整点：以前整批会被写进 23 点分区，00 点那条从 console 的
  // 「当前小时 + 上一小时」查询里消失。
  await processor.process([
    { ...event, eventId: "1".repeat(32), occurredAt: "2026-07-28T23:59:59.000Z" },
    { ...event, eventId: "2".repeat(32), occurredAt: "2026-07-29T00:00:01.000Z", service: "backend" },
  ]);

  const keys = objects.map((object) => String(object.Key)).sort();
  assert.equal(keys.length, 2);
  assert.match(keys[0], /^environment=production\/date=2026-07-28\/hour=23\//);
  assert.match(keys[1], /^environment=production\/date=2026-07-29\/hour=00\//);
});

test("labels a mixed-service partition as mixed", async () => {
  const objects: Array<Record<string, unknown>> = [];
  const dynamo = { send: async () => ({}) };
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

  await processor.process([
    { ...event, eventId: "3".repeat(32) },
    { ...event, eventId: "4".repeat(32), service: "backend" },
  ]);

  assert.equal(objects.length, 1);
  assert.match(String(objects[0].Key), /service=mixed-/);
});

test("releases claims when the S3 detail write fails so a retry can redo the batch", async () => {
  const claims = new Set<string>();
  let s3Failures = 1;
  const dynamo = {
    async send(command: { input: Record<string, unknown>; constructor: { name: string } }) {
      const input = command.input;
      if ("ConditionExpression" in input) {
        const id = String((input.Item as Record<string, unknown>).pk);
        if (claims.has(id)) {
          const error = new Error("duplicate");
          error.name = "ConditionalCheckFailedException";
          throw error;
        }
        claims.add(id);
      } else if ("Key" in input && !("UpdateExpression" in input)) {
        claims.delete(String((input.Key as Record<string, unknown>).pk));
      }
      return {};
    },
  };
  const s3 = {
    async send() {
      if (s3Failures > 0) { s3Failures -= 1; throw new Error("S3 unavailable"); }
      return {};
    },
  };
  const processor = new EventProcessor(dynamo as never, s3 as never, {
    stateTable: "state",
    aggregateTable: "aggregate",
    detailBucket: "detail",
    retentionDays: 30,
  });

  await assert.rejects(() => processor.process([event]), /S3 unavailable/);
  // 认领已被释放，所以重投递能真正重做；旧实现这里会返回 0 并永久丢明细。
  assert.equal(claims.size, 0);
  assert.equal(await processor.process([event]), 1);
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
