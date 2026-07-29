import type { AggregateMetric } from "@customer-ops/aiops-agent";

// 必须与 cleaner/src/events.ts 的 histogramBoundsMs 逐项一致：cleaner 把 duration
// 记进 histogram_b{i}（i = 首个满足 value <= bound 的下标），超出最后一档时记进
// 溢出桶 b{bounds.length}。以前这里多写了一个 600_000 充当第 18 档，实际它对应的
// 是溢出桶而非真实边界——一旦 cleaner 增删边界，两边会静默错位且分位数全偏。
const histogramBounds = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000,
  10_000, 20_000, 60_000, 120_000, 300_000,
];
// 溢出桶没有上界，展示时用最后一档的两倍近似（与既有口径一致）。
const overflowApproximationMs = (histogramBounds.at(-1) ?? 0) * 2;

export function normalizeMetric(item: Record<string, unknown>): AggregateMetric {
  const sampleCount = number(item.sampleCount);
  return {
    bucketStart: String(item.bucketStart ?? item.sk ?? ""),
    service: String(item.service ?? "unknown"),
    release: String(item.release ?? "unknown"),
    operation: String(item.operation ?? "unknown"),
    sampleCount,
    errorCount: number(item.errorCount),
    averageDurationMs: sampleCount ? number(item.totalDurationMs) / sampleCount : 0,
    p50DurationMs: percentile(item, sampleCount, 0.5),
    p95DurationMs: percentile(item, sampleCount, 0.95),
    p99DurationMs: percentile(item, sampleCount, 0.99),
    gpuUtilizationPercent: average(item.mgpuUtilizationPercent, sampleCount),
    gpuMemoryUsedBytes: average(item.mgpuMemoryUsedBytes, sampleCount),
    gpuMemoryTotalBytes: average(item.mgpuMemoryTotalBytes, sampleCount),
    queueMs: average(item.mqueueMs, sampleCount),
    ttftMs: average(item.mttftMs, sampleCount),
    tokensPerSecond: average(item.mtokensPerSecond, sampleCount),
  };
}

function percentile(item: Record<string, unknown>, count: number, quantile: number) {
  if (!count) return 0;
  const target = Math.ceil(count * quantile);
  let cumulative = 0;
  // <= 而非 <：最后一轮读的是溢出桶 b{bounds.length}
  for (let index = 0; index <= histogramBounds.length; index++) {
    cumulative += number(item[`histogram_b${index}`]);
    if (cumulative >= target) return histogramBounds[index] ?? overflowApproximationMs;
  }
  return overflowApproximationMs;
}

function average(value: unknown, count: number) {
  return value == null || !count ? undefined : number(value) / count;
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function demoMetrics(): AggregateMetric[] {
  const services = ["browser", "model-api", "backend", "model-server"];
  return Array.from({ length: 48 }, (_, index) => {
    const service = services[index % services.length];
    const pressure = index > 38 && service === "model-server";
    return {
      bucketStart: new Date(Date.now() - (47 - index) * 60_000).toISOString(),
      service,
      release: index < 24 ? "2026.07.27" : "2026.07.28",
      operation: service === "model-server" ? "model.chat" : "http.request",
      sampleCount: 18 + (index % 9),
      errorCount: index > 43 && service === "model-api" ? 2 : 0,
      averageDurationMs: pressure ? 3_900 : 280 + (index % 5) * 80,
      p50DurationMs: pressure ? 3_000 : 300 + (index % 4) * 50,
      p95DurationMs: pressure ? 8_000 : 500 + (index % 4) * 150,
      p99DurationMs: pressure ? 10_000 : 800 + (index % 4) * 200,
      ...(service === "model-server" ? {
        gpuUtilizationPercent: pressure ? 94 : 68 + index % 14,
        gpuMemoryUsedBytes: (pressure ? 15.1 : 12.4) * 1024 ** 3,
        gpuMemoryTotalBytes: 16 * 1024 ** 3,
        queueMs: pressure ? 1_650 : 80 + index * 3,
        ttftMs: pressure ? 6_200 : 1_450 + index * 17,
        tokensPerSecond: pressure ? 8.4 : 18.2,
      } : {}),
    };
  });
}
