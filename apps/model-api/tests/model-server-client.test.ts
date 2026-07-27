import { describe, expect, it, vi } from "vitest";

import { ModelServerClient } from "../src/services/model-server-client";

describe("ModelServerClient", () => {
  it("解析 1024 维 embedding", async () => {
    const vector = Array.from({ length: 1024 }, () => 0.01);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        object: "list",
        data: [{ index: 0, object: "embedding", embedding: vector }],
        model: "bge-m3",
        usage: { prompt_tokens: 3, total_tokens: 3 },
      }),
    );
    const client = new ModelServerClient({
      baseUrl: "http://model.test/v1",
      apiKey: "test-key",
      fetchImpl,
    });

    await expect(client.embed("冰箱不制冷")).resolves.toEqual(vector);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://model.test/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-key",
        }),
      }),
    );
  });

  it("拒绝越界的 rerank index", async () => {
    const client = new ModelServerClient({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          model: "bge-reranker-v2-m3",
          results: [{ index: 5, relevance_score: 0.9 }],
        }),
      ),
    });
    await expect(
      client.rerank("query", ["only document"], 1),
    ).rejects.toThrow("out-of-range");
  });
});
