import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzePerformance,
  ruleFindings,
  type AggregateMetric,
} from "./index.js";

test("detects GPU memory and queue pressure without an LLM", () => {
  const findings = ruleFindings([{
    bucketStart: new Date().toISOString(), service: "model-server",
    operation: "model.chat", sampleCount: 10, errorCount: 0,
    averageDurationMs: 2_000, p50DurationMs: 1_000,
    p95DurationMs: 4_000, p99DurationMs: 5_000,
    gpuMemoryUsedBytes: 15, gpuMemoryTotalBytes: 16, queueMs: 1_500,
  }]);
  assert.equal(findings.length, 2);
  assert.equal(findings[0].severity, "critical");
});

test("falls back to deterministic rules when Kimi is not configured", async () => {
  const report = await analyzePerformance([], { apiKey: "" });
  assert.equal(report.source, "rules");
  assert.equal(report.readOnly, true);
});

test("sends only aggregate allowlist fields to kimi-k3", async () => {
  let requestBody = "";
  const report = await analyzePerformance([{
    bucketStart: "2026-07-28T00:00:00Z",
    service: "model-server",
    release: "release-a",
    operation: "model.chat",
    sampleCount: 1,
    errorCount: 0,
    averageDurationMs: 10,
    p50DurationMs: 10,
    p95DurationMs: 10,
    p99DurationMs: 10,
    prompt: "must-not-leave-process",
  } as AggregateMetric & { prompt: string }], {
    apiKey: "test",
    fetchImpl: async (_input, init) => {
      requestBody = String(init?.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ summary: "ok", findings: [] }) } }],
      }), { status: 200 });
    },
  });
  assert.equal(report.source, "kimi-k3");
  assert.equal(requestBody.includes("must-not-leave-process"), false);
  assert.equal(JSON.parse(requestBody).model, "kimi-k3");
});
