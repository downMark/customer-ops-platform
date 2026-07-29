import {
  PerformanceClient,
  createBrowserSink,
  formatTraceparent,
} from "@customer-ops/performance";
import AuthService from "./apis/services/Auth";
import { getModelApiBaseURL } from "./apis/runtime";

export const browserPerformance = new PerformanceClient({
  service: "browser",
  // 自定义构建脚本使用 Vite mode=prod，而不是 Vite 内置的 production。
  // 只判断 MODE === "production" 会把线上浏览器事件错误标成 local，进而被
  // production 查询和 S3 分区过滤掉。部署工作流会显式注入环境；prod 判断是
  // 本地执行 production build 时的安全后备。
  environment: import.meta.env.VITE_APP_ENVIRONMENT
    || (["prod", "production"].includes(import.meta.env.MODE) ? "production" : "local"),
  release: import.meta.env.VITE_APP_RELEASE || "development",
  sampleRate: 0.1,
  autoFlush: typeof window !== "undefined",
  sink: createBrowserSink(
    `${getModelApiBaseURL()}/api/telemetry/v1/batch`,
    () => AuthService.getAccessToken(),
  ),
});

// Web Vitals 是「一个页面一个终值」的指标，不是流式样本。原实现在每次观测回调里
// 都 recordMetric：LCP 每出现一个候选、CLS 每发生一次偏移都会产出一条事件，于是
// DynamoDB 聚合的 sampleCount 把中间态也算进去，console 用 总和/样本数 求出来的
// 是「中间值的平均」而不是最终 LCP —— 指标本身是错的，顺带还放大了上报量。
// 改为：观测期间只在内存里收敛，页面隐藏时一次性上报终值。
const vitals: { lcpMs?: number; cls?: number; inpMs?: number; ttfbMs?: number } = {};
let vitalsReported = false;

export function observeWebVitals() {
  if (typeof PerformanceObserver === "undefined") return;
  const supported = PerformanceObserver.supportedEntryTypes;
  if (supported.includes("largest-contentful-paint")) {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const entry = entries[entries.length - 1];
      if (entry) vitals.lcpMs = entry.startTime;
    });
    observer.observe({ type: "largest-contentful-paint", buffered: true });
  }
  if (supported.includes("layout-shift")) {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
        if (!shift.hadRecentInput) vitals.cls = (vitals.cls ?? 0) + (shift.value ?? 0);
      }
    });
    observer.observe({ type: "layout-shift", buffered: true });
  }
  if (supported.includes("event")) {
    const observer = new PerformanceObserver((list) => {
      const inp = Math.max(...list.getEntries().map((entry) => entry.duration), 0);
      if (inp) vitals.inpMs = Math.max(vitals.inpMs ?? 0, inp);
    });
    observer.observe({ type: "event", buffered: true, durationThreshold: 40 } as PerformanceObserverInit);
  }
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (navigation) {
    vitals.ttfbMs = navigation.responseStart - navigation.requestStart;
  }
  installLifecycleFlush();
}

// force 只给开发态的探针用：正常链路一个页面只上报一次终值。
export function reportVitals(force = false) {
  if (vitalsReported && !force) return;
  const measurements = Object.fromEntries(
    Object.entries(vitals).filter(([, value]) => Number.isFinite(value)),
  );
  if (!Object.keys(measurements).length) return;
  vitalsReported = true;
  browserPerformance.recordMetric("web_vital.page", measurements);
}

// 客户端队列默认 1s 刷一次，页面被关闭/切走时这一秒的事件（包括刚捕获的错误）
// 会随页面一起丢掉。sink 已经用 keepalive: true，卸载期间的请求能发出去，
// 但需要有人在这一刻触发 flush。
let lifecycleInstalled = false;

export function installLifecycleFlush() {
  if (lifecycleInstalled || typeof window === "undefined") return;
  lifecycleInstalled = true;
  const drain = () => {
    reportVitals();
    void browserPerformance.flush();
  };
  window.addEventListener("pagehide", drain);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") drain();
  });
}

// 自检页产生的事件走的是和真实错误完全相同的代码路径，在 Sentry 里本来无法区分。
// 生产环境开放自检后这会污染 issue 列表和告警，所以在自检触发前后的短窗口内，
// 给捕获到的错误打上 component=diagnostics —— 该字段会被同步器映射成 Sentry tag，
// 可以直接用 !component:diagnostics 从查询和告警条件里排除。
//
// 用时间窗而不是显式传参，是因为未捕获异常和资源错误由浏览器异步派发给全局监听器，
// 中间没有可以透传标记的调用链。代价是窗口内偶发的真实错误也会被标记，
// 考虑到窗口只有几秒且用户正停在自检页上，这个误标概率可以接受。
let diagnosticsUntil = 0;

export function markDiagnostics(windowMs = 4_000) {
  diagnosticsUntil = Date.now() + windowMs;
}

function diagnosticsAttributes() {
  return Date.now() <= diagnosticsUntil ? { component: "diagnostics" } : {};
}

// 全局错误捕获。之前只有 performanceFetch 的 catch 和 Chat 的 SSE 分支会上报，
// 控制台里的未捕获异常、未处理的 Promise 拒绝、资源加载失败一条都没进链路。
// React 19 对未捕获的渲染错误会走 reportError()，同样触发 window 的 error 事件，
// 所以不额外加 ErrorBoundary 也能覆盖到。
export function installErrorReporting() {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (event) => {
    const target = event.target;
    // 资源加载失败（script/img/link）不冒泡到 window.onerror，只有捕获阶段能拿到，
    // 且没有 Error 对象，只能靠 target 判定。
    if (target && target !== window && target instanceof HTMLElement) {
      const tagName = target.tagName.toLowerCase();
      const resourceError = new Error(tagName);
      resourceError.name = "ResourceLoadError";
      // 只带标签名，不带 src/href：资源地址可能含查询参数，属于不可外传的输入。
      browserPerformance.captureError(
        "browser.resource", resourceError, undefined, tagName, diagnosticsAttributes(),
      );
      return;
    }
    browserPerformance.captureError(
      "browser.uncaught",
      event.error instanceof Error ? event.error : new Error(event.message),
      undefined,
      // 文件名 + 行号让同类错误能聚成一个 issue；只取 basename 且去掉查询串。
      locationCode(event.filename, event.lineno),
      diagnosticsAttributes(),
    );
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    browserPerformance.captureError(
      "browser.unhandled_rejection", toError(event.reason), undefined, undefined,
      diagnosticsAttributes(),
    );
  });

  installLifecycleFlush();
}

function toError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  // 非 Error 的拒绝值（字符串、对象）也要有稳定的类型名，否则全部聚成 UnknownError。
  const error = new Error("non-error rejection");
  error.name = "UnhandledRejection";
  return error;
}

function locationCode(filename?: string, line?: number): string | undefined {
  if (!filename) return undefined;
  const base = filename.split("?")[0].split("/").pop();
  return base ? `${base}:${line ?? 0}`.slice(0, 64) : undefined;
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
    browserPerformance.captureError(
      "api.request", error, span.context, undefined, diagnosticsAttributes(),
    );
    throw error;
  }
}
