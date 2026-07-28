import { z } from "zod";

import { config } from "../config";
import { withTimeout } from "../lib/signals";
import {
  performanceClient,
  requestTraceContext,
} from "../performance";
import { formatTraceparent } from "../performance-sdk";

const embeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      embedding: z.array(z.number().finite()).length(1024),
    }),
  ),
  model: z.string(),
});

const rerankResponseSchema = z.object({
  model: z.string(),
  results: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      relevance_score: z.number().min(0).max(1),
    }),
  ),
});

type ModelServerClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class ModelServerClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ModelServerClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? config.modelServerBaseUrl).replace(
      /\/$/,
      "",
    );
    this.apiKey = options.apiKey ?? config.modelServerApiKey;
    this.timeoutMs = options.timeoutMs ?? config.ragTimeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embed(text: string, signal?: AbortSignal, traceparent?: string): Promise<number[]> {
    const payload = await this.post(
      "/embeddings",
      {
        model: config.embeddingModel,
        input: text,
      },
      signal,
      traceparent,
    );
    const parsed = embeddingResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.data.length !== 1) {
      throw new Error("model-server returned an invalid embedding response", {
        cause: parsed.success ? undefined : parsed.error,
      });
    }
    return parsed.data.data[0].embedding;
  }

  async rerank(
    query: string,
    documents: string[],
    topN: number,
    signal?: AbortSignal,
    traceparent?: string,
  ): Promise<Array<{ index: number; score: number }>> {
    const payload = await this.post(
      "/rerank",
      {
        model: config.rerankModel,
        query,
        documents,
        top_n: topN,
      },
      signal,
      traceparent,
    );
    const parsed = rerankResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("model-server returned an invalid rerank response", {
        cause: parsed.error,
      });
    }
    if (
      parsed.data.results.some((result) => result.index >= documents.length)
    ) {
      throw new Error("model-server returned an out-of-range document index");
    }
    return parsed.data.results.map((result) => ({
      index: result.index,
      score: result.relevance_score,
    }));
  }

  private async post(
    path: string,
    body: unknown,
    signal?: AbortSignal,
    traceparent?: string,
  ): Promise<unknown> {
    const operation = path === "/embeddings"
      ? "model.embedding" : path === "/rerank" ? "model.rerank" : "model.request";
    const span = performanceClient.startSpan(operation, {
      parent: requestTraceContext(traceparent),
      attributes: { endpoint: `/v1${path}`, httpMethod: "POST" },
    });
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          traceparent: formatTraceparent(span.context),
        },
        body: JSON.stringify(body),
        signal: withTimeout(this.timeoutMs, signal),
      });
      span.finish(response.ok ? "ok" : "error", {
        ...(Array.isArray((body as { input?: unknown }).input)
          ? { batchSize: (body as { input: unknown[] }).input.length } : {}),
        ...(Array.isArray((body as { documents?: unknown }).documents)
          ? { batchSize: (body as { documents: unknown[] }).documents.length } : {}),
      });
      if (!response.ok) {
        throw new Error(`model-server request failed with ${response.status}`);
      }
      return response.json();
    } catch (error) {
      span.finish(error instanceof Error && error.name === "AbortError"
        ? "cancelled" : "error");
      performanceClient.captureError(operation, error, span.context);
      throw error;
    }
  }
}

export const modelServerClient = new ModelServerClient();
