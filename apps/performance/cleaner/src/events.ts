import { gunzipSync } from "node:zlib";

export interface PerformanceEvent {
  schema: "customer-ops.performance.v1";
  eventId: string;
  occurredAt: string;
  service: string;
  environment: string;
  release: string;
  eventType: "span" | "metric" | "error";
  operation: string;
  status: "ok" | "error" | "timeout" | "cancelled" | "unknown";
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  durationMs?: number;
  sampled: boolean;
  measurements: Record<string, number>;
  attributes: Record<string, string | number>;
}

const measurementKeys = new Set([
  "count", "queueMs", "ttftMs", "tokensPerSecond", "inputTokens",
  "outputTokens", "batchSize", "gpuUtilizationPercent", "gpuMemoryUsedBytes",
  "gpuMemoryTotalBytes", "gpuTemperatureCelsius", "gpuPowerWatts",
  "cpuPercent", "rssBytes", "lcpMs", "inpMs", "cls", "ttfbMs",
  "prefetchMs", "renderMs", "totalMs",
]);
const attributeKeys = new Set([
  "component", "endpoint", "httpMethod", "httpStatusCode", "model",
  "finishReason", "errorType", "errorCode", "errorFingerprint", "route",
  "runtime", "gpuName",
]);

export function parseCloudWatchRecord(data: Uint8Array): PerformanceEvent[] {
  return decodeCloudWatchRecord(data).events;
}

export function decodeCloudWatchRecord(data: Uint8Array): {
  events: PerformanceEvent[];
  invalidCount: number;
} {
  const envelope = JSON.parse(gunzipSync(data).toString("utf8")) as {
    messageType?: string;
    logEvents?: Array<{ message?: string }>;
  };
  if (envelope.messageType === "CONTROL_MESSAGE") {
    return { events: [], invalidCount: 0 };
  }
  let invalidCount = 0;
  const events = (envelope.logEvents ?? []).flatMap(({ message }) => {
      try {
        const parsed = JSON.parse(message ?? "");
        if (isPerformanceEvent(parsed)) return [sanitize(parsed)];
      } catch {
        // Count malformed subscribed records without preserving their contents.
      }
      invalidCount += 1;
      return [];
    });
  return { events, invalidCount };
}

export function isPerformanceEvent(value: unknown): value is PerformanceEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return event.schema === "customer-ops.performance.v1"
    && typeof event.eventId === "string" && /^[0-9a-f]{32}$/.test(event.eventId)
    && typeof event.traceId === "string" && /^[0-9a-f]{32}$/.test(event.traceId)
    && typeof event.spanId === "string" && /^[0-9a-f]{16}$/.test(event.spanId)
    && typeof event.occurredAt === "string" && !Number.isNaN(Date.parse(event.occurredAt))
    && [
      "browser", "frontend-ssr", "model-api", "backend", "event-worker",
      "model-server", "performance-cleaner",
    ].includes(String(event.service))
    && typeof event.environment === "string" && /^[a-z0-9_-]{1,32}$/.test(event.environment)
    && typeof event.release === "string" && event.release.length >= 1 && event.release.length <= 128
    && ["span", "metric", "error"].includes(String(event.eventType))
    && typeof event.operation === "string" && /^[a-z][a-z0-9_.-]{1,95}$/.test(event.operation)
    && ["ok", "error", "timeout", "cancelled", "unknown"].includes(String(event.status))
    && (event.parentSpanId === null
      || (typeof event.parentSpanId === "string" && /^[0-9a-f]{16}$/.test(event.parentSpanId)))
    && typeof event.sampled === "boolean"
    && (event.durationMs === undefined
      || (typeof event.durationMs === "number" && Number.isFinite(event.durationMs)
        && event.durationMs >= 0 && event.durationMs <= 86_400_000))
    && typeof event.measurements === "object" && event.measurements !== null
    && typeof event.attributes === "object" && event.attributes !== null;
}

function sanitize(event: PerformanceEvent): PerformanceEvent {
  const measurements = Object.fromEntries(
    Object.entries(event.measurements)
      .filter(([key, value]) => measurementKeys.has(key) && Number.isFinite(value))
      .map(([key, value]) => [key, Math.max(-1e15, Math.min(1e15, value))]),
  );
  const attributes = Object.fromEntries(
    Object.entries(event.attributes)
      .filter(([key, value]) => attributeKeys.has(key) && ["string", "number"].includes(typeof value))
      .map(([key, value]) => {
        if (typeof value !== "string") return [key, value];
        const redacted = ["endpoint", "route"].includes(key)
          ? value.split("?", 1)[0] : value;
        return [key, redacted.slice(0, 96)];
      }),
  );
  return {
    schema: "customer-ops.performance.v1",
    eventId: event.eventId,
    occurredAt: new Date(event.occurredAt).toISOString(),
    service: event.service.slice(0, 32),
    environment: event.environment,
    release: event.release.slice(0, 128),
    eventType: event.eventType,
    operation: event.operation,
    status: event.status,
    traceId: event.traceId,
    spanId: event.spanId,
    parentSpanId: event.parentSpanId && /^[0-9a-f]{16}$/.test(event.parentSpanId)
      ? event.parentSpanId : null,
    ...(Number.isFinite(event.durationMs) ? { durationMs: Math.max(0, event.durationMs!) } : {}),
    sampled: Boolean(event.sampled),
    measurements,
    attributes,
  };
}

export const histogramBoundsMs = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000,
  10_000, 20_000, 60_000, 120_000, 300_000,
];

export function histogramBucket(value: number): string {
  const index = histogramBoundsMs.findIndex((bound) => value <= bound);
  return `b${index === -1 ? histogramBoundsMs.length : index}`;
}

export function minuteBucket(occurredAt: string): string {
  const date = new Date(occurredAt);
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}
