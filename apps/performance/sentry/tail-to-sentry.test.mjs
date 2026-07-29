import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  parsePerformanceLine,
  postEnvelope,
  runTail,
} from "./tail-to-sentry.mjs";

const event = {
  schema: "customer-ops.performance.v1",
  eventId: "d".repeat(32),
  occurredAt: "2026-07-29T08:00:00.000Z",
  service: "backend",
  environment: "local",
  release: "development",
  eventType: "error",
  operation: "diagnostics.internal",
  status: "error",
  traceId: "e".repeat(32),
  spanId: "f".repeat(16),
  parentSpanId: null,
  sampled: true,
  measurements: {},
  attributes: { errorType: "DiagnosticsInternalError" },
};

test("extracts only customer-ops performance JSON from mixed stdout", () => {
  assert.equal(parsePerformanceLine("backend listening"), null);
  assert.equal(parsePerformanceLine('{"message":"ordinary log"}'), null);
  assert.deepEqual(
    parsePerformanceLine(`2026-07-29 INFO ${JSON.stringify(event)}`),
    event,
  );
});

test("posts an envelope with Sentry authentication", async () => {
  let request;
  await postEnvelope(
    { eventId: event.eventId, body: "envelope" },
    {
      envelopeUrl: "http://127.0.0.1:9000/api/1/envelope/",
      sentryKey: "public-key",
      fetchImpl: async (url, init) => {
        request = { url, init };
        return new Response("", { status: 200 });
      },
    },
  );
  assert.equal(request.url, "http://127.0.0.1:9000/api/1/envelope/");
  assert.match(request.init.headers["x-sentry-auth"], /sentry_key=public-key/);
});

test("forwards failures and ignores ordinary output", async () => {
  const requests = [];
  const progress = [];
  const summary = await runTail({
    input: Readable.from([
      "ordinary output\n",
      `${JSON.stringify(event)}\n`,
      `${JSON.stringify({ ...event, eventId: "a".repeat(32), eventType: "span", status: "ok" })}\n`,
    ]),
    dsn: "http://public-key@127.0.0.1:9000/1",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response("", { status: 200 });
    },
    onProgress: (value) => progress.push(value),
  });
  assert.deepEqual(summary, { scanned: 2, forwarded: 1, failed: 0 });
  assert.equal(requests.length, 1);
  assert.equal(progress[0].operation, "diagnostics.internal");
});
