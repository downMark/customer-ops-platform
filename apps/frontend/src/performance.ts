import {
  PerformanceClient,
  createBrowserSink,
  formatTraceparent,
} from "@customer-ops/performance";
import AuthService from "./apis/services/Auth";
import { getModelApiBaseURL } from "./apis/runtime";

export const browserPerformance = new PerformanceClient({
  service: "browser",
  environment: import.meta.env.MODE === "production" ? "production" : "local",
  release: import.meta.env.VITE_APP_RELEASE || "development",
  sampleRate: 0.1,
  sink: createBrowserSink(
    `${getModelApiBaseURL()}/api/telemetry/v1/batch`,
    () => AuthService.getAccessToken(),
  ),
});

export function observeWebVitals() {
  if (typeof PerformanceObserver === "undefined") return;
  const supported = PerformanceObserver.supportedEntryTypes;
  if (supported.includes("largest-contentful-paint")) {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const entry = entries[entries.length - 1];
      if (entry) browserPerformance.recordMetric("web_vital.lcp", { lcpMs: entry.startTime });
    });
    observer.observe({ type: "largest-contentful-paint", buffered: true });
  }
  if (supported.includes("layout-shift")) {
    let cls = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
        if (!shift.hadRecentInput) cls += shift.value ?? 0;
      }
      browserPerformance.recordMetric("web_vital.cls", { cls });
    });
    observer.observe({ type: "layout-shift", buffered: true });
  }
  if (supported.includes("event")) {
    const observer = new PerformanceObserver((list) => {
      const inp = Math.max(...list.getEntries().map((entry) => entry.duration), 0);
      if (inp) browserPerformance.recordMetric("web_vital.inp", { inpMs: inp });
    });
    observer.observe({ type: "event", buffered: true, durationThreshold: 40 } as PerformanceObserverInit);
  }
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (navigation) {
    browserPerformance.recordMetric("web_vital.ttfb", {
      ttfbMs: navigation.responseStart - navigation.requestStart,
    });
  }
}

export async function performanceFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    window.location.origin,
  );
  const method = String(init.method || "GET").toUpperCase();
  const span = browserPerformance.startSpan("api.request", {
    attributes: {
      endpoint: url.pathname,
      httpMethod: method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS",
    },
  });
  const headers = new Headers(init.headers);
  headers.set("traceparent", formatTraceparent(span.context));
  try {
    const response = await fetch(input, { ...init, headers });
    span.finish(response.ok ? "ok" : "error");
    return response;
  } catch (error) {
    span.finish(error instanceof Error && error.name === "AbortError"
      ? "cancelled" : "error");
    browserPerformance.captureError("api.request", error, span.context);
    throw error;
  }
}
