export interface AggregateMetric {
  bucketStart: string;
  service: string;
  release?: string;
  operation: string;
  sampleCount: number;
  errorCount: number;
  averageDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  gpuUtilizationPercent?: number;
  gpuMemoryUsedBytes?: number;
  gpuMemoryTotalBytes?: number;
  queueMs?: number;
  ttftMs?: number;
  tokensPerSecond?: number;
}

export interface AiOpsFinding {
  severity: "critical" | "warning" | "info";
  title: string;
  evidence: string[];
  recommendation: string;
  confidence: number;
}

export interface AiOpsReport {
  generatedAt: string;
  model: string;
  summary: string;
  findings: AiOpsFinding[];
  source: "kimi-k3" | "rules";
  readOnly: true;
}

export interface AiOpsConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function analyzePerformance(
  metrics: AggregateMetric[],
  config: AiOpsConfig = {},
): Promise<AiOpsReport> {
  const safeMetrics = sanitizeAggregates(metrics);
  const rules = ruleFindings(safeMetrics);
  const apiKey = config.apiKey ?? process.env.MOONSHOT_API_KEY;
  const model = config.model ?? process.env.AIOPS_MODEL ?? "kimi-k3";
  if (!apiKey) {
    return {
      generatedAt: new Date().toISOString(),
      model,
      summary: rules.length
        ? `规则诊断发现 ${rules.length} 个需要关注的问题；配置 MOONSHOT_API_KEY 后可启用 Kimi K3 深度分析。`
        : "当前指标未触发已知容量或延迟规则。",
      findings: rules,
      source: "rules",
      readOnly: true,
    };
  }

  const fetchImpl = config.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 30_000);
  try {
    const response = await fetchImpl(
      `${(config.baseUrl ?? process.env.MOONSHOT_BASE_URL ?? "https://api.moonshot.ai/v1").replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: [
                "你是 Customer Ops 的只读 AIOps Agent。",
                "只能分析提供的脱敏性能聚合，不得建议或声称已经执行任何写操作。",
                "重点判断 GPU 显存、GPU 利用率、推理锁排队、TTFT、tokens/s、错误扩散和版本回归。",
                "输出 JSON：summary 字符串；findings 数组，每项含 severity、title、evidence 字符串数组、recommendation、confidence(0-1)。",
                "证据必须引用输入中的数值；信息不足时明确说明。",
              ].join("\n"),
            },
            {
              role: "user",
              content: JSON.stringify({
                aggregates: safeMetrics.slice(-500),
                deterministicFindings: rules,
                privacy: "No prompts, responses, user identifiers, order identifiers, credentials, bodies or query strings are present.",
              }),
            },
          ],
        }),
      },
    );
    if (!response.ok) throw new Error(`Kimi API returned ${response.status}`);
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("Kimi API response did not contain content");
    const parsed = JSON.parse(content) as { summary?: unknown; findings?: unknown };
    return {
      generatedAt: new Date().toISOString(),
      model,
      summary: typeof parsed.summary === "string" ? parsed.summary : "Kimi K3 已完成分析。",
      findings: normalizeFindings(parsed.findings, rules),
      source: "kimi-k3",
      readOnly: true,
    };
  } catch {
    return {
      generatedAt: new Date().toISOString(),
      model,
      summary: "Kimi K3 暂时不可用，已回退到本地确定性规则诊断。",
      findings: rules,
      source: "rules",
      readOnly: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeAggregates(metrics: AggregateMetric[]): AggregateMetric[] {
  return metrics.slice(-500).map((item) => {
    const safe: AggregateMetric = {
      bucketStart: String(item.bucketStart).slice(0, 40),
      service: safeLabel(item.service, 32),
      release: item.release ? safeLabel(item.release, 128) : undefined,
      operation: safeLabel(item.operation, 96),
      sampleCount: finite(item.sampleCount),
      errorCount: finite(item.errorCount),
      averageDurationMs: finite(item.averageDurationMs),
      p50DurationMs: finite(item.p50DurationMs),
      p95DurationMs: finite(item.p95DurationMs),
      p99DurationMs: finite(item.p99DurationMs),
    };
    for (const key of [
      "gpuUtilizationPercent", "gpuMemoryUsedBytes", "gpuMemoryTotalBytes",
      "queueMs", "ttftMs", "tokensPerSecond",
    ] as const) {
      const value = item[key];
      if (value !== undefined) safe[key] = finite(value);
    }
    return safe;
  });
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function safeLabel(value: string, length: number): string {
  return String(value).replace(/[^A-Za-z0-9._/-]/g, "_").slice(0, length);
}

export function ruleFindings(metrics: AggregateMetric[]): AiOpsFinding[] {
  const latest = metrics.slice(-120);
  const findings: AiOpsFinding[] = [];
  const gpu = latest.filter((item) => item.gpuMemoryTotalBytes && item.gpuMemoryUsedBytes);
  const peakMemory = gpu.reduce((peak, item) => Math.max(
    peak,
    (item.gpuMemoryUsedBytes ?? 0) / Math.max(1, item.gpuMemoryTotalBytes ?? 1),
  ), 0);
  if (peakMemory >= 0.9) {
    findings.push({
      severity: "critical",
      title: "GPU 显存接近容量上限",
      evidence: [`最近窗口峰值显存占用 ${(peakMemory * 100).toFixed(1)}%`],
      recommendation: "优先降低 context/batch 或并发，确认没有 CPU offload；扩容前先比较锁等待与 GPU 利用率。",
      confidence: 0.98,
    });
  }
  const queue = latest.filter((item) => (item.queueMs ?? 0) >= 1_000);
  if (queue.length) {
    const peak = Math.max(...queue.map((item) => item.queueMs ?? 0));
    findings.push({
      severity: "warning",
      title: "共享推理锁出现明显排队",
      evidence: [`${queue.length} 个时间桶 queueMs ≥ 1000ms`, `峰值 ${peak.toFixed(0)}ms`],
      recommendation: "拆分 chat 与 embedding/rerank 工作负载，或限制入口并发；不要仅提高 Web worker 数量。",
      confidence: 0.95,
    });
  }
  const ttft = latest.filter((item) => (item.ttftMs ?? 0) >= 5_000);
  if (ttft.length) {
    findings.push({
      severity: "warning",
      title: "首 token 延迟超出目标",
      evidence: [`${ttft.length} 个时间桶 TTFT ≥ 5000ms`],
      recommendation: "将 TTFT 与 queueMs 对齐：若同步升高则治理排队，否则检查 prompt token、GPU offload 和模型加载状态。",
      confidence: 0.9,
    });
  }
  const errors = latest.reduce((sum, item) => sum + item.errorCount, 0);
  const samples = latest.reduce((sum, item) => sum + item.sampleCount, 0);
  if (samples && errors / samples >= 0.05) {
    findings.push({
      severity: "critical",
      title: "平台错误率升高",
      evidence: [`最近窗口错误率 ${((errors / samples) * 100).toFixed(1)}%（${errors}/${samples}）`],
      recommendation: "按 service/release 对比错误扩散范围，并从对应 trace 进入本地 Sentry 定位首个失败 span。",
      confidence: 0.97,
    });
  }
  return findings;
}

function normalizeFindings(value: unknown, fallback: AiOpsFinding[]): AiOpsFinding[] {
  if (!Array.isArray(value)) return fallback;
  return value.slice(0, 12).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.title !== "string" || typeof record.recommendation !== "string") return [];
    return [{
      severity: ["critical", "warning", "info"].includes(String(record.severity))
        ? record.severity as AiOpsFinding["severity"] : "info",
      title: record.title.slice(0, 160),
      evidence: Array.isArray(record.evidence)
        ? record.evidence.filter((entry): entry is string => typeof entry === "string").slice(0, 6)
        : [],
      recommendation: record.recommendation.slice(0, 800),
      confidence: Math.max(0, Math.min(1, Number(record.confidence) || 0.5)),
    }];
  });
}
