import { z } from "zod";

import { config } from "../config";
import { withTimeout } from "../lib/signals";

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

  async embed(text: string, signal?: AbortSignal): Promise<number[]> {
    const payload = await this.post(
      "/embeddings",
      {
        model: config.embeddingModel,
        input: text,
      },
      signal,
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
  ): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: withTimeout(this.timeoutMs, signal),
    });
    if (!response.ok) {
      throw new Error(`model-server request failed with ${response.status}`);
    }
    return response.json();
  }
}

export const modelServerClient = new ModelServerClient();
