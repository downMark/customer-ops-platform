import { registerApiRoute } from "@mastra/core/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { backendClient } from "../../services/backend-client";

const identifier = z.string().regex(/^[0-9a-f]+$/);
const eventSchema = z.object({
  schema: z.literal("customer-ops.performance.v1"),
  eventId: identifier.length(32),
  occurredAt: z.string().datetime(),
  service: z.enum(["browser", "frontend-ssr"]),
  environment: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  release: z.string().min(1).max(128),
  eventType: z.enum(["span", "metric", "error"]),
  operation: z.string().regex(/^[a-z][a-z0-9_.-]{1,95}$/),
  status: z.enum(["ok", "error", "timeout", "cancelled", "unknown"]),
  traceId: identifier.length(32),
  spanId: identifier.length(16),
  parentSpanId: identifier.length(16).nullable(),
  durationMs: z.number().min(0).max(86_400_000).optional(),
  sampled: z.boolean(),
  measurements: z.record(z.number()).refine(
    (value) => Object.keys(value).every((key) => [
      "count", "queueMs", "ttftMs", "tokensPerSecond", "inputTokens",
      "outputTokens", "batchSize", "gpuUtilizationPercent",
      "gpuMemoryUsedBytes", "gpuMemoryTotalBytes", "gpuTemperatureCelsius",
      "gpuPowerWatts", "cpuPercent", "rssBytes", "lcpMs", "inpMs", "cls",
      "ttfbMs", "prefetchMs", "renderMs", "totalMs",
    ].includes(key)),
  ),
  attributes: z.record(z.union([z.string(), z.number()])).refine(
    (value) => Object.keys(value).every((key) => [
      "component", "endpoint", "httpMethod", "httpStatusCode", "model",
      "finishReason", "errorType", "errorCode", "errorFingerprint", "route",
      "runtime", "gpuName",
    ].includes(key)),
  ),
}).strict();

const batchSchema = z.object({ events: z.array(eventSchema).min(1).max(20) }).strict();
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_BATCHES = 60;

export function parseTelemetryBatch(value: unknown) {
  return batchSchema.safeParse(value);
}

export function consumeTelemetryRateLimit(
  authorization: string,
  now = Date.now(),
): boolean {
  const key = createHash("sha256").update(authorization).digest("hex");
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    if (rateLimits.size > 10_000) {
      for (const [candidate, limit] of rateLimits) {
        if (limit.resetAt <= now) rateLimits.delete(candidate);
      }
    }
    return true;
  }
  if (current.count >= RATE_LIMIT_BATCHES) return false;
  current.count += 1;
  return true;
}

export const telemetryRoute = registerApiRoute("/api/telemetry/v1/batch", {
  method: "POST",
  requiresAuth: false,
  handler: async (c) => {
    const authorization = c.req.header("authorization");
    if (!authorization?.match(/^Bearer\s+\S+$/i)) {
      return c.json({ success: false, msg: "unauthorized" }, 401);
    }
    if (!await backendClient.validateAuth(authorization, c.req.raw.signal)) {
      return c.json({ success: false, msg: "unauthorized" }, 401);
    }
    if (!consumeTelemetryRateLimit(authorization)) {
      return c.json({ success: false, msg: "rate limit exceeded" }, 429);
    }
    if (Number(c.req.header("content-length") || "0") > 65_536) {
      return c.json({ success: false, msg: "payload too large" }, 413);
    }
    const parsed = parseTelemetryBatch(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ success: false, msg: "invalid telemetry batch" }, 400);
    }
    for (const event of parsed.data.events) console.log(JSON.stringify(event));
    return c.json({ success: true }, 202);
  },
});
