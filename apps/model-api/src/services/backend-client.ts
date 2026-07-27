import { config } from "../config";
import { z } from "zod";
import {
  loginResultSchema,
  type LoginRequest,
  type LoginResult,
} from "../contracts/auth";
import { orderSchema, type Order } from "../contracts/order";
import {
  knowledgeSearchResponseSchema,
  type KnowledgeChunk,
  type KnowledgeFilters,
} from "../contracts/knowledge";
import { AppError } from "../lib/errors";
import { withTimeout } from "../lib/signals";

export type GetOrderInput = {
  orderId: string;
  authorization: string;
  traceId: string;
  signal?: AbortSignal;
};

export type SearchKnowledgeInput = {
  vector: number[];
  topK: number;
  filters?: KnowledgeFilters;
  authorization: string;
  traceId: string;
  signal?: AbortSignal;
};

export type BackendClientOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class BackendClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BackendClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? config.backendBaseUrl).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? config.backendTimeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getOrder(input: GetOrderInput): Promise<Order> {
    const url = `${this.baseUrl}/api/orders/${encodeURIComponent(input.orderId)}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: input.authorization,
          "x-trace-id": input.traceId,
        },
        signal: withTimeout(this.timeoutMs, input.signal),
      });
    } catch (error) {
      throw new AppError(
        "ORDER_SERVICE_UNAVAILABLE",
        "订单服务暂时不可用，请稍后重试",
        503,
        true,
        { cause: error },
      );
    }

    if (response.status === 401) {
      throw new AppError("UNAUTHORIZED", "登录状态无效，请重新登录", 401);
    }
    if (response.status === 403) {
      throw new AppError(
        "ORDER_ACCESS_DENIED",
        "您无权查看该订单",
        403,
      );
    }
    if (response.status === 404) {
      throw new AppError("ORDER_NOT_FOUND", "没有找到该订单", 404);
    }
    if (!response.ok) {
      throw new AppError(
        "ORDER_SERVICE_UNAVAILABLE",
        "订单服务暂时不可用，请稍后重试",
        503,
        true,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new AppError(
        "ORDER_SERVICE_UNAVAILABLE",
        "订单服务返回了无效数据",
        502,
        true,
        { cause: error },
      );
    }

    const parsed = backendEnvelopeSchema(orderSchema).safeParse(payload);
    if (!parsed.success) {
      throw new AppError(
        "ORDER_SERVICE_UNAVAILABLE",
        "订单服务返回了无效数据",
        502,
        true,
        { cause: parsed.error },
      );
    }

    return parsed.data.data;
  }

  async login(input: LoginRequest, signal?: AbortSignal): Promise<LoginResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
        signal: withTimeout(this.timeoutMs, signal),
      });
    } catch (error) {
      throw new AppError(
        "ORDER_SERVICE_UNAVAILABLE",
        "账号服务暂时不可用，请稍后重试",
        503,
        true,
        { cause: error },
      );
    }

    if (response.status === 401) {
      throw new AppError("UNAUTHORIZED", "用户名或密码错误", 401);
    }
    if (!response.ok) {
      throw new AppError(
        "ORDER_SERVICE_UNAVAILABLE",
        "账号服务暂时不可用，请稍后重试",
        503,
        true,
      );
    }

    const payload: unknown = await response.json().catch(() => null);
    const parsed = backendEnvelopeSchema(loginResultSchema).safeParse(payload);
    if (!parsed.success) {
      throw new AppError(
        "ORDER_SERVICE_UNAVAILABLE",
        "账号服务返回了无效数据",
        502,
        true,
        { cause: parsed.error },
      );
    }
    return parsed.data.data;
  }

  async searchKnowledge(
    input: SearchKnowledgeInput,
  ): Promise<KnowledgeChunk[]> {
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/api/knowledge/search`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: input.authorization,
            "content-type": "application/json",
            "x-trace-id": input.traceId,
          },
          body: JSON.stringify({
            vector: input.vector,
            topK: input.topK,
            ...(input.filters ? { filters: input.filters } : {}),
          }),
          signal: withTimeout(this.timeoutMs, input.signal),
        },
      );
    } catch (error) {
      throw new AppError(
        "KNOWLEDGE_SERVICE_UNAVAILABLE",
        "知识检索服务暂时不可用",
        503,
        true,
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new AppError(
        "KNOWLEDGE_SERVICE_UNAVAILABLE",
        "知识检索服务暂时不可用",
        response.status >= 500 ? 503 : 502,
        true,
      );
    }
    const payload: unknown = await response.json().catch(() => null);
    const parsed = backendEnvelopeSchema(
      knowledgeSearchResponseSchema,
    ).safeParse(payload);
    if (!parsed.success) {
      throw new AppError(
        "KNOWLEDGE_SERVICE_UNAVAILABLE",
        "知识检索服务返回了无效数据",
        502,
        true,
        { cause: parsed.error },
      );
    }
    return parsed.data.data.items;
  }

  async isHealthy(signal?: AbortSignal): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/health`, {
        headers: { accept: "application/json" },
        signal: withTimeout(Math.min(this.timeoutMs, 3_000), signal),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const backendClient = new BackendClient();

function backendEnvelopeSchema<T>(dataSchema: z.ZodType<T>) {
  return z.object({
    code: z.number(),
    success: z.literal(true),
    msg: z.string(),
    data: dataSchema,
  });
}
