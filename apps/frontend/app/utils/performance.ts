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
    this.metrics.renderTime = Date.now() - this.startTime;
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

    return result;
  }
}

export const createPerformanceMonitor = () => new PerformanceMonitor(); 