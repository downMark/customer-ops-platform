import {
  formatTraceparent,
  PerformanceClient,
  parseTraceparent,
  type TraceContext,
} from "./performance-sdk";
import { AsyncLocalStorage } from "node:async_hooks";

import { config } from "./config";

export const performanceClient = new PerformanceClient({
  service: "model-api",
  environment: config.environment,
  release: config.release,
  sampleRate: 0.1,
  slowThresholdMs: 2_000,
});

export function requestTraceContext(traceparent?: string): TraceContext | null {
  return parseTraceparent(traceparent);
}

const traceStorage = new AsyncLocalStorage<TraceContext>();

export function withPerformanceTrace<T>(
  context: TraceContext,
  callback: () => Promise<T>,
): Promise<T> {
  return traceStorage.run(context, callback);
}

export const tracedFetch: typeof fetch = (input, init = {}) => {
  const parent = traceStorage.getStore();
  if (!parent) return fetch(input, init);
  const span = performanceClient.startSpan("model.generate", {
    parent,
    attributes: { component: "model-provider" },
  });
  const headers = new Headers(init.headers);
  headers.set("traceparent", formatTraceparent(span.context));
  return fetch(input, { ...init, headers })
    .then((response) => {
      span.finish(response.ok ? "ok" : "error", {});
      return response;
    })
    .catch((error) => {
      span.finish(error instanceof Error && error.name === "AbortError"
        ? "cancelled" : "error");
      performanceClient.captureError("model.generate", error, span.context);
      throw error;
    });
};
