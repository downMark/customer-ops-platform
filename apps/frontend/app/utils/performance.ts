export interface PerformanceMetrics {
  renderTime: number;
  prefetchTime: number;
  totalTime: number;
  memoryUsage?: NodeJS.MemoryUsage;
}

export class PerformanceMonitor {
  private startTime: number;
  private metrics: Partial<PerformanceMetrics> = {};

  constructor() {
    this.startTime = Date.now();
  }

  markPrefetchComplete() {
    this.metrics.prefetchTime = Date.now() - this.startTime;
  }

  markRenderComplete() {
    this.metrics.renderTime =
      Date.now() - this.startTime - (this.metrics.prefetchTime || 0);
  }

  finish(): PerformanceMetrics {
    const totalTime = Date.now() - this.startTime;
    const memoryUsage = process.memoryUsage();
    
    const result: PerformanceMetrics = {
      renderTime: this.metrics.renderTime || 0,
      prefetchTime: this.metrics.prefetchTime || 0,
      totalTime,
      memoryUsage,
    };

    // 记录性能指标
    console.log('SSR Performance:', {
      totalTime: `${result.totalTime}ms`,
      prefetchTime: `${result.prefetchTime}ms`,
      renderTime: `${result.renderTime}ms`,
      memoryUsage: {
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
      },
    });
    ssrPerformance.recordMetric("ssr.render", {
      prefetchMs: result.prefetchTime,
      renderMs: result.renderTime,
      totalMs: result.totalTime,
      rssBytes: memoryUsage.rss,
    }, { component: "react-ssr" });
    void ssrPerformance.flush();

    return result;
  }
}

export const createPerformanceMonitor = () => new PerformanceMonitor();
import { PerformanceClient } from "@customer-ops/performance";

const ssrPerformance = new PerformanceClient({
  service: "frontend-ssr",
  environment: process.env.APP_ENVIRONMENT || "local",
  release: process.env.APP_RELEASE || "development",
  sampleRate: 0.1,
  autoFlush: false,
});
