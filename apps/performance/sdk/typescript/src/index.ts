export const PERFORMANCE_SCHEMA = "customer-ops.performance.v1" as const;

export type PerformanceService =
  | "browser"
  | "frontend-ssr"
  | "model-api"
  | "backend"
  | "event-worker"
  | "model-server"
  | "performance-cleaner";
export type EventStatus = "ok" | "error" | "timeout" | "cancelled" | "unknown";
export type EventType = "span" | "metric" | "error";

export type Measurements = Partial<Record<
  | "count" | "queueMs" | "ttftMs" | "tokensPerSecond"
  | "inputTokens" | "outputTokens" | "batchSize"
  | "gpuUtilizationPercent" | "gpuMemoryUsedBytes" | "gpuMemoryTotalBytes"
  | "gpuTemperatureCelsius" | "gpuPowerWatts" | "cpuPercent" | "rssBytes"
  | "lcpMs" | "inpMs" | "cls" | "ttfbMs"
  | "prefetchMs" | "renderMs" | "totalMs",
  number
>>;

export type SafeAttributes = Partial<{
  component: string;
  endpoint: string;
  httpMethod: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
  httpStatusCode: number;
  model: string;
  finishReason: string;
  errorType: string;
  errorCode: string;
  errorFingerprint: string;
  route: string;
  runtime: string;
  gpuName: string;
}>;

export interface PerformanceEventV1 {
  schema: typeof PERFORMANCE_SCHEMA;
  eventId: string;
  occurredAt: string;
  service: PerformanceService;
  environment: string;
  release: string;
  eventType: EventType;
  operation: string;
  status: EventStatus;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  durationMs?: number;
  sampled: boolean;
  measurements: Measurements;
  attributes: SafeAttributes;
}

export interface PerformanceConfig {
  service: PerformanceService;
  environment?: string;
  release?: string;
  sampleRate?: number;
  slowThresholdMs?: number;
  maxQueueSize?: number;
  flushIntervalMs?: number;
  sink?: (events: PerformanceEventV1[]) => void | Promise<void>;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

const hex = (bytes: number): string => {
  const data = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(data);
  return Array.from(data, (value) => value.toString(16).padStart(2, "0")).join("");
};

export function parseTraceparent(value?: string | null): TraceContext | null {
  const match = value?.trim().match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-(0[01])$/);
  return match ? { traceId: match[1], spanId: match[2], sampled: match[3] === "01" } : null;
}

export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? "01" : "00"}`;
}

const defaultSink = (events: PerformanceEventV1[]) => {
  for (const event of events) console.log(JSON.stringify(event));
};
const measurementAllowlist = new Set([
  "count", "queueMs", "ttftMs", "tokensPerSecond", "inputTokens",
  "outputTokens", "batchSize", "gpuUtilizationPercent",
  "gpuMemoryUsedBytes", "gpuMemoryTotalBytes", "gpuTemperatureCelsius",
  "gpuPowerWatts", "cpuPercent", "rssBytes", "lcpMs", "inpMs", "cls",
  "ttfbMs", "prefetchMs", "renderMs", "totalMs",
]);
const attributeAllowlist = new Set([
  "component", "endpoint", "httpMethod", "httpStatusCode", "model",
  "finishReason", "errorType", "errorCode", "errorFingerprint", "route",
  "runtime", "gpuName",
]);

export class PerformanceClient {
  private readonly config: Required<Omit<PerformanceConfig, "sink">>;
  private readonly sink: NonNullable<PerformanceConfig["sink"]>;
  private queue: PerformanceEventV1[] = [];
  private flushing = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor(config: PerformanceConfig) {
    this.config = {
      service: config.service,
      environment: sanitizeEnvironment(config.environment ?? "local"),
      release: String(config.release ?? "development").slice(0, 128),
      sampleRate: clamp(config.sampleRate ?? 0.1, 0, 1),
      slowThresholdMs: Math.max(0, config.slowThresholdMs ?? 2_000),
      maxQueueSize: Math.max(1, config.maxQueueSize ?? 500),
      flushIntervalMs: Math.max(100, config.flushIntervalMs ?? 1_000),
    };
    this.sink = config.sink ?? defaultSink;
    this.timer = setInterval(() => void this.flush(), this.config.flushIntervalMs);
    this.timer.unref?.();
  }

  startSpan(
    operation: string,
    options: {
      parent?: TraceContext | null;
      attributes?: SafeAttributes;
      measurements?: Measurements;
    } = {},
  ): PerformanceSpan {
    const sampled = options.parent?.sampled ?? Math.random() < this.config.sampleRate;
    return new PerformanceSpan(this, {
      operation,
      traceId: options.parent?.traceId ?? hex(16),
      spanId: hex(8),
      parentSpanId: options.parent?.spanId ?? null,
      sampled,
      attributes: options.attributes ?? {},
      measurements: options.measurements ?? {},
    });
  }

  recordMetric(operation: string, measurements: Measurements, attributes: SafeAttributes = {}) {
    const spanId = hex(8);
    this.enqueue(this.event({
      eventType: "metric", operation, status: "ok", traceId: hex(16), spanId,
      parentSpanId: null, sampled: true, measurements, attributes,
    }));
  }

  captureError(operation: string, error: unknown, context?: TraceContext, code?: string) {
    const errorType = error instanceof Error ? error.name : "UnknownError";
    const fingerprint = stableFingerprint(`${operation}:${errorType}:${code ?? ""}`);
    this.enqueue(this.event({
      eventType: "error", operation, status: "error",
      traceId: context?.traceId ?? hex(16), spanId: hex(8),
      parentSpanId: context?.spanId ?? null, sampled: true, measurements: {},
      attributes: { errorType, errorCode: code?.slice(0, 64), errorFingerprint: fingerprint },
    }));
  }

  emitSpan(input: SpanInput, durationMs: number, status: EventStatus, extra: Measurements) {
    const force = status !== "ok" || durationMs >= this.config.slowThresholdMs;
    if (!input.sampled && !force) return;
    this.enqueue(this.event({
      eventType: "span", operation: input.operation, status,
      traceId: input.traceId, spanId: input.spanId, parentSpanId: input.parentSpanId,
      durationMs, sampled: input.sampled || force,
      measurements: { ...input.measurements, ...extra }, attributes: input.attributes,
    }));
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.splice(0, this.queue.length);
    try {
      await this.sink(batch);
    } catch {
      // Observability must never become a production dependency.
    } finally {
      this.flushing = false;
    }
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  private enqueue(event: PerformanceEventV1) {
    if (this.queue.length >= this.config.maxQueueSize) this.queue.shift();
    this.queue.push(event);
  }

  private event(input: Omit<PerformanceEventV1, "schema" | "eventId" | "occurredAt" | "service" | "environment" | "release">): PerformanceEventV1 {
    return {
      schema: PERFORMANCE_SCHEMA, eventId: hex(16), occurredAt: new Date().toISOString(),
      service: this.config.service, environment: this.config.environment,
      release: this.config.release, ...input,
      measurements: sanitizeMeasurements(input.measurements),
      attributes: sanitizeAttributes(input.attributes),
    };
  }
}

interface SpanInput {
  operation: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  sampled: boolean;
  attributes: SafeAttributes;
  measurements: Measurements;
}

export class PerformanceSpan {
  private readonly startedAt = performance.now();
  private finished = false;
  readonly context: TraceContext;

  constructor(private readonly client: PerformanceClient, private readonly input: SpanInput) {
    this.context = { traceId: input.traceId, spanId: input.spanId, sampled: input.sampled };
  }

  finish(status: EventStatus = "ok", measurements: Measurements = {}) {
    if (this.finished) return;
    this.finished = true;
    this.client.emitSpan(this.input, Math.max(0, performance.now() - this.startedAt), status, measurements);
  }
}

export function createBrowserSink(endpoint: string, getToken?: () => string | null) {
  return async (events: PerformanceEventV1[]) => {
    const token = getToken?.();
    if (getToken && !token) return;
    await fetch(endpoint, {
      method: "POST",
      keepalive: true,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ events }),
    });
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeEnvironment(value: string) {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 32);
  return sanitized || "unknown";
}

function stableFingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sanitizeMeasurements(value: Measurements): Measurements {
  return Object.fromEntries(Object.entries(value).filter(
    ([key, measurement]) => measurementAllowlist.has(key)
      && typeof measurement === "number" && Number.isFinite(measurement),
  )) as Measurements;
}

function sanitizeAttributes(value: SafeAttributes): SafeAttributes {
  const sanitized: Record<string, string | number> = {};
  for (const [key, attribute] of Object.entries(value)) {
    if (!attributeAllowlist.has(key) || !["string", "number"].includes(typeof attribute)) continue;
    if (typeof attribute === "number") {
      if (Number.isFinite(attribute)) sanitized[key] = attribute;
      continue;
    }
    const safe = ["endpoint", "route"].includes(key) ? attribute.split("?")[0] : attribute;
    sanitized[key] = safe.slice(0, 96);
  }
  return sanitized as SafeAttributes;
}
