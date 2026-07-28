import { describe, expect, it } from "vitest";

import {
  consumeTelemetryRateLimit,
  parseTelemetryBatch,
} from "../src/mastra/routes/telemetry";

function event(overrides: Record<string, unknown> = {}) {
  return {
    schema: "customer-ops.performance.v1",
    eventId: "a".repeat(32),
    occurredAt: "2026-07-28T00:00:00.000Z",
    service: "browser",
    environment: "production",
    release: "test",
    eventType: "metric",
    operation: "web.lcp",
    status: "ok",
    traceId: "b".repeat(32),
    spanId: "c".repeat(16),
    parentSpanId: null,
    sampled: true,
    measurements: { lcpMs: 1200 },
    attributes: { component: "rum" },
    ...overrides,
  };
}

describe("telemetry ingestion validation", () => {
  it("accepts only the telemetry whitelist", () => {
    expect(parseTelemetryBatch({ events: [event()] }).success).toBe(true);
    expect(parseTelemetryBatch({
      events: [event({ attributes: { userId: "secret" } })],
    }).success).toBe(false);
    expect(parseTelemetryBatch({
      events: [event({ prompt: "must never be collected" })],
    }).success).toBe(false);
  });

  it("enforces event count and per-token batch rate", () => {
    expect(parseTelemetryBatch({ events: Array.from({ length: 21 }, () => event()) }).success)
      .toBe(false);
    const token = `Bearer rate-limit-${crypto.randomUUID()}`;
    for (let index = 0; index < 60; index += 1) {
      expect(consumeTelemetryRateLimit(token, 1000)).toBe(true);
    }
    expect(consumeTelemetryRateLimit(token, 1000)).toBe(false);
    expect(consumeTelemetryRateLimit(token, 61_001)).toBe(true);
  });
});
