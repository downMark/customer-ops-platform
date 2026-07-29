// Sentry 在这条链路里只补 S3 明细没有的东西：issue 聚合、等级与影响面。
// 性能指标仍旧直读 DynamoDB/S3，不绕经 Sentry，避免把短路径换成长路径。

export type SentryIssue = {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  level: string;
  status: string;
  count: number;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  permalink?: string;
};

const baseUrl = (process.env.SENTRY_BASE_URL || "").replace(/\/$/, "");
const authToken = process.env.SENTRY_AUTH_TOKEN || "";
const organization = process.env.SENTRY_ORG || "";
const project = process.env.SENTRY_PROJECT || "";
const timeoutMs = Number(process.env.SENTRY_TIMEOUT_MS || "5000");

export const sentryConfigured = Boolean(baseUrl && authToken && organization && project);

export async function loadIssues(limit = 25): Promise<SentryIssue[]> {
  const url = new URL(`${baseUrl}/api/0/projects/${organization}/${project}/issues/`);
  url.searchParams.set("query", "is:unresolved");
  url.searchParams.set("statsPeriod", "24h");
  url.searchParams.set("limit", String(Math.min(100, Math.max(1, limit))));

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${authToken}`, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // 不透传原始异常：里面可能带上 Authorization 之外的连接细节。
    throw named("SentryUnreachable");
  }
  if (!response.ok) throw named(`SentryHttp${response.status}`);

  const payload: unknown = await response.json().catch(() => null);
  if (!Array.isArray(payload)) throw named("SentryUnexpectedPayload");
  return payload.map(normalizeIssue);
}

function normalizeIssue(raw: unknown): SentryIssue {
  const item = (raw ?? {}) as Record<string, unknown>;
  const metadata = (item.metadata ?? {}) as Record<string, unknown>;
  return {
    id: String(item.id ?? ""),
    shortId: String(item.shortId ?? item.id ?? ""),
    title: String(item.title ?? metadata.type ?? "未命名 issue"),
    culprit: String(item.culprit ?? metadata.value ?? ""),
    level: String(item.level ?? "error"),
    status: String(item.status ?? "unresolved"),
    // Sentry 把 count 序列化成字符串，这里统一收敛为数字。
    count: number(item.count),
    userCount: number(item.userCount),
    firstSeen: String(item.firstSeen ?? ""),
    lastSeen: String(item.lastSeen ?? ""),
    permalink: safeLink(item.permalink),
  };
}

// permalink 来自 Sentry 响应，按不可信输入处理：只放行 http(s)，挡掉 javascript: 之类的伪协议。
function safeLink(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function named(name: string) {
  const error = new Error(name);
  error.name = name;
  return error;
}

export function demoIssues(): SentryIssue[] {
  const minute = 60_000;
  return [
    {
      id: "demo-1",
      shortId: "CUSTOMER-OPS-3F",
      title: "ModelServerTimeout: chat completion exceeded 30s",
      culprit: "model-api/services/model-server-client",
      level: "error",
      status: "unresolved",
      count: 34,
      userCount: 12,
      firstSeen: new Date(Date.now() - 180 * minute).toISOString(),
      lastSeen: new Date(Date.now() - 2 * minute).toISOString(),
    },
    {
      id: "demo-2",
      shortId: "CUSTOMER-OPS-2A",
      title: "OrderServiceUnavailable: backend returned 503",
      culprit: "model-api/services/backend-client",
      level: "warning",
      status: "unresolved",
      count: 9,
      userCount: 7,
      firstSeen: new Date(Date.now() - 95 * minute).toISOString(),
      lastSeen: new Date(Date.now() - 18 * minute).toISOString(),
    },
    {
      id: "demo-3",
      shortId: "CUSTOMER-OPS-17",
      title: "SSE stream aborted before done event",
      culprit: "frontend/pages/Chat",
      level: "info",
      status: "unresolved",
      count: 5,
      userCount: 5,
      firstSeen: new Date(Date.now() - 1_440 * minute).toISOString(),
      lastSeen: new Date(Date.now() - 240 * minute).toISOString(),
    },
  ];
}
