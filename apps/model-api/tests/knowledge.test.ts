import { afterEach, describe, expect, it, vi } from "vitest";

import { backendClient } from "../src/services/backend-client";
import { retrieveKnowledge } from "../src/services/knowledge";
import { modelServerClient } from "../src/services/model-server-client";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("retrieveKnowledge", () => {
  it("执行 embed、检索、rerank 并应用阈值", async () => {
    vi.spyOn(modelServerClient, "embed").mockResolvedValue(
      Array.from({ length: 1024 }, () => 0.01),
    );
    vi.spyOn(backendClient, "searchKnowledge").mockResolvedValue([
      {
        id: 1,
        documentId: "refrigerator-guide",
        chunkIndex: 0,
        content: "检查冰箱电源",
        source: "refrigerator.md",
        metadata: { productId: "PROD-006" },
        score: 0.8,
      },
      {
        id: 2,
        documentId: "monitor-guide",
        chunkIndex: 0,
        content: "检查显示器信号线",
        source: "monitor.md",
        metadata: { productId: "PROD-008" },
        score: 0.7,
      },
      {
        id: 3,
        documentId: "television-guide",
        chunkIndex: 0,
        content: "检查电视背光和输入源",
        source: "television.md",
        metadata: { productId: "PROD-007" },
        score: 0.6,
      },
      {
        id: 4,
        documentId: "unrelated-guide",
        chunkIndex: 0,
        content: "这条候选不应送入 reranker",
        source: "unrelated.md",
        metadata: {},
        score: 0.5,
      },
    ]);
    const rerank = vi.spyOn(modelServerClient, "rerank").mockResolvedValue([
      { index: 0, score: 0.95 },
      { index: 1, score: 0.05 },
    ]);

    const result = await retrieveKnowledge({
      query: "冰箱不制冷",
      authorization: "Bearer token",
      traceId: "trace-rag",
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      documentId: "refrigerator-guide",
      rerankScore: 0.95,
    });
    expect(rerank).toHaveBeenCalledWith(
      "冰箱不制冷",
      ["检查冰箱电源", "检查显示器信号线", "检查电视背光和输入源"],
      3,
      expect.any(AbortSignal),
    );
  });

  it("检索失败时降级为空资料", async () => {
    vi.spyOn(modelServerClient, "embed").mockRejectedValue(
      new Error("model unavailable"),
    );
    await expect(
      retrieveKnowledge({
        query: "电视无画面",
        authorization: "Bearer token",
        traceId: "trace-degrade",
      }),
    ).resolves.toEqual([]);
  });

  it("请求取消或总超时时降级为空资料", async () => {
    vi.spyOn(modelServerClient, "embed").mockImplementation(
      async (_query, signal) =>
        new Promise<number[]>((_, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true },
          );
        }),
    );

    await expect(
      retrieveKnowledge({
        query: "显示器无信号",
        authorization: "Bearer token",
        traceId: "trace-timeout",
        signal: AbortSignal.timeout(10),
      }),
    ).resolves.toEqual([]);
  });
});
