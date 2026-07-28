import { useEffect, useMemo, useState } from "react";

type Metric = {
  bucketStart: string; service: string; release?: string; operation: string;
  sampleCount: number; errorCount: number; averageDurationMs: number;
  p50DurationMs: number; p95DurationMs: number; p99DurationMs: number;
  gpuUtilizationPercent?: number;
  gpuMemoryUsedBytes?: number; gpuMemoryTotalBytes?: number;
  queueMs?: number; ttftMs?: number; tokensPerSecond?: number;
};
type Trace = {
  traceId: string; spanId: string; parentSpanId: string | null;
  occurredAt: string; service: string; release: string; operation: string;
  status: string; durationMs?: number; eventType: string;
};
type Report = {
  generatedAt: string; model: string; summary: string; source: string;
  findings: Array<{ severity: string; title: string; evidence: string[]; recommendation: string; confidence: number }>;
};

const formatMs = (value: number) => value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${Math.round(value)}ms`;
const formatBytes = (value: number) => `${(value / 1024 ** 3).toFixed(1)} GB`;

export function App() {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [traces, setTraces] = useState<Trace[]>([]);
  const [mode, setMode] = useState("loading");
  const [awsConnected, setAwsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [service, setService] = useState("all");
  const [release, setRelease] = useState("all");

  const refresh = async () => {
    const [health, data, traceData] = await Promise.all([
      fetch("/api/health").then((response) => response.json()),
      fetch("/api/metrics").then((response) => response.json()),
      fetch("/api/traces").then((response) => response.json()),
    ]);
    setMode(health.mode);
    setAwsConnected(Boolean(health.awsConnected));
    setConnectionError(health.awsError ?? "");
    setMetrics(data.metrics ?? []);
    setTraces(traceData.traces ?? []);
  };
  useEffect(() => { void refresh(); }, []);

  const serviceMetrics = service === "all"
    ? metrics : metrics.filter((item) => item.service === service);
  const filtered = release === "all"
    ? serviceMetrics : serviceMetrics.filter((item) => item.release === release);
  const total = filtered.reduce((sum, item) => sum + item.sampleCount, 0);
  const errors = filtered.reduce((sum, item) => sum + item.errorCount, 0);
  const p50 = Math.max(...filtered.map((item) => item.p50DurationMs), 0);
  const p95 = Math.max(...filtered.map((item) => item.p95DurationMs), 0);
  const p99 = Math.max(...filtered.map((item) => item.p99DurationMs), 0);
  const model = [...filtered].reverse().find((item) => item.service === "model-server");
  const services = useMemo(() => [...new Set(metrics.map((item) => item.service))], [metrics]);
  const releases = useMemo(
    () => [...new Set(metrics.map((item) => item.release).filter(Boolean) as string[])].sort(),
    [metrics],
  );
  const latestRelease = releases.at(-1);
  const previousRelease = releases.at(-2);
  const releaseP95 = (value?: string) => Math.max(
    ...serviceMetrics.filter((item) => item.release === value).map((item) => item.p95DurationMs),
    0,
  );
  const latestP95 = releaseP95(latestRelease);
  const previousP95 = releaseP95(previousRelease);
  const regression = previousP95 ? (latestP95 - previousP95) / previousP95 * 100 : 0;
  const latestTraceId = [...traces]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0]?.traceId;
  const waterfall = traces
    .filter((item) => item.traceId === latestTraceId)
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  const waterfallStart = Math.min(...waterfall.map((item) => Date.parse(item.occurredAt)), Date.now());
  const waterfallEnd = Math.max(
    ...waterfall.map((item) => Date.parse(item.occurredAt) + (item.durationMs ?? 0)),
    waterfallStart + 1,
  );

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const response = await fetch("/api/aiops/analyze", { method: "POST" });
      setReport(await response.json());
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand-mark">CO</div>
        <nav aria-label="主导航">
          <button className="nav-active" aria-label="性能总览">◫</button>
          <button aria-label="Trace">⌁</button>
          <button aria-label="AI 诊断">✦</button>
        </nav>
        <span
          className={`rail-status ${mode === "aws" && !awsConnected ? "failed" : ""}`}
          title={mode === "aws" && !awsConnected ? `AWS 连接失败：${connectionError}` : "只读连接正常"}
        />
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">Customer Ops / Observability</p>
            <h1>性能控制台</h1>
          </div>
          <div className="top-actions">
            <span
              className={`mode ${mode === "aws" && !awsConnected ? "failed" : ""}`}
              title={connectionError}
            >
              <i />
              {mode === "demo" ? "演示数据" : awsConnected ? "AWS 已连接" : "AWS 连接失败"}
            </span>
            <select value={service} onChange={(event) => setService(event.target.value)} aria-label="筛选服务">
              <option value="all">全部服务</option>
              {services.map((item) => <option key={item}>{item}</option>)}
            </select>
            <select value={release} onChange={(event) => setRelease(event.target.value)} aria-label="筛选版本">
              <option value="all">全部版本</option>
              {releases.map((item) => <option key={item}>{item}</option>)}
            </select>
            <button className="ghost" onClick={() => void refresh()}>刷新</button>
          </div>
        </header>

        <section className="hero-grid">
          <article className="hero-copy">
            <span className="live-pill">LIVE · 6H WINDOW</span>
            <h2>GPU 压力正在<br /><em>变成排队延迟</em></h2>
            <p>把显存、推理锁、首 token 与服务错误放在同一时间线上，先定位瓶颈，再决定是否扩容。</p>
          </article>
          <article className="gpu-card">
            <div className="card-head"><span>MODEL SERVER</span><strong>GPU 0 · T4</strong></div>
            <div className="gauge" style={{ "--gauge": `${model?.gpuUtilizationPercent ?? 0}%` } as React.CSSProperties}>
              <div><strong>{Math.round(model?.gpuUtilizationPercent ?? 0)}%</strong><span>GPU UTIL</span></div>
            </div>
            <div className="gpu-stats">
              <div><span>显存</span><strong>{formatBytes(model?.gpuMemoryUsedBytes ?? 0)}</strong></div>
              <div><span>锁等待</span><strong>{formatMs(model?.queueMs ?? 0)}</strong></div>
              <div><span>生成速度</span><strong>{(model?.tokensPerSecond ?? 0).toFixed(1)} t/s</strong></div>
            </div>
          </article>
        </section>

        <section className="kpis" aria-label="关键指标">
          <Kpi label="请求样本" value={total.toLocaleString()} note="当前筛选窗口" />
          <Kpi label="错误率" value={total ? `${(errors / total * 100).toFixed(1)}%` : "0%"} note={`${errors} 个失败样本`} danger={errors > 0} />
          <Kpi label="延迟分位" value={formatMs(p95)} note={`P50 ${formatMs(p50)} · P99 ${formatMs(p99)}`} />
          <Kpi label="模型 TTFT" value={formatMs(model?.ttftMs ?? 0)} note="目标 < 5.0s" danger={(model?.ttftMs ?? 0) >= 5_000} />
          <Kpi
            label="版本回归"
            value={previousRelease ? `${regression >= 0 ? "+" : ""}${regression.toFixed(1)}%` : "—"}
            note={previousRelease ? `${previousRelease} → ${latestRelease}` : "需要至少两个版本"}
            danger={regression > 10}
          />
        </section>

        <section className="content-grid">
          <article className="panel chart-panel">
            <div className="panel-title">
              <div><span>LATENCY PROFILE</span><h3>最近性能趋势</h3></div>
              <div className="legend"><i className="lime" />P95 <i className="cyan" />平均</div>
            </div>
            <div className="bar-chart" aria-label="延迟柱状趋势图">
              {filtered.slice(-36).map((item, index) => {
                const max = Math.max(p95, 1);
                return <div className="bar-slot" key={`${item.bucketStart}-${index}`} title={`${item.service} ${formatMs(item.p95DurationMs)}`}>
                  <i style={{ height: `${Math.max(4, item.p95DurationMs / max * 100)}%` }} />
                  <b style={{ height: `${Math.max(2, item.averageDurationMs / max * 100)}%` }} />
                </div>;
              })}
            </div>
            <div className="axis"><span>-36m</span><span>-24m</span><span>-12m</span><span>现在</span></div>
          </article>

          <article className="panel ai-panel">
            <div className="panel-title">
              <div><span>KIMI K3 · READ ONLY</span><h3>AIOps Agent</h3></div>
              <button className="primary" onClick={() => void analyze()} disabled={analyzing}>
                {analyzing ? "分析中…" : "运行诊断"}
              </button>
            </div>
            {report ? (
              <div className="report">
                <p className="report-summary">{report.summary}</p>
                {report.findings.map((finding, index) => (
                  <div className={`finding ${finding.severity}`} key={`${finding.title}-${index}`}>
                    <div><strong>{finding.title}</strong><span>{Math.round(finding.confidence * 100)}% 置信度</span></div>
                    <p>{finding.evidence.join(" · ")}</p>
                    <small>{finding.recommendation}</small>
                  </div>
                ))}
                {!report.findings.length && <div className="empty">没有发现达到阈值的问题。</div>}
              </div>
            ) : (
              <div className="agent-ready">
                <div className="orb">K3</div>
                <h4>等待一次只读诊断</h4>
                <p>Agent 只会读取脱敏聚合与 trace 摘要，不具备重启、扩缩容或修改 AWS 的权限。</p>
              </div>
            )}
          </article>
        </section>

        <section className="panel trace-panel">
          <div className="panel-title">
            <div><span>SANITIZED TRACE</span><h3>跨服务瀑布</h3></div>
            <code>{latestTraceId ? `${latestTraceId.slice(0, 12)}…` : "暂无明细"}</code>
          </div>
          {waterfall.length ? (
            <div className="waterfall">
              {waterfall.map((item) => {
                const range = Math.max(1, waterfallEnd - waterfallStart);
                const left = (Date.parse(item.occurredAt) - waterfallStart) / range * 100;
                const width = Math.max(1.5, (item.durationMs ?? 0) / range * 100);
                return <div className="trace-row" key={item.spanId}>
                  <div><strong>{item.service}</strong><span>{item.operation}</span></div>
                  <div className="trace-track">
                    <i className={item.status === "ok" ? "" : "failed"} style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }} />
                  </div>
                  <code>{formatMs(item.durationMs ?? 0)}</code>
                </div>;
              })}
            </div>
          ) : <div className="empty">当前小时没有脱敏 trace 明细；聚合指标仍可正常查看。</div>}
        </section>
      </main>
    </div>
  );
}

function Kpi({ label, value, note, danger = false }: { label: string; value: string; note: string; danger?: boolean }) {
  return <article className={`kpi ${danger ? "danger" : ""}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}
