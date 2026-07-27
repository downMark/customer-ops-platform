import { config } from "../config";
import type {
  KnowledgeFilters,
  KnowledgeReference,
} from "../contracts/knowledge";
import { withTimeout } from "../lib/signals";
import { backendClient } from "./backend-client";
import { modelServerClient } from "./model-server-client";

type RetrieveKnowledgeInput = {
  query: string;
  authorization: string;
  traceId: string;
  filters?: KnowledgeFilters;
  signal?: AbortSignal;
};

export async function retrieveKnowledge(
  input: RetrieveKnowledgeInput,
): Promise<KnowledgeReference[]> {
  if (!config.ragEnabled) {
    return [];
  }

  const signal = withTimeout(config.ragTimeoutMs, input.signal);
  try {
    const vector = await modelServerClient.embed(input.query, signal);
    const candidates = await backendClient.searchKnowledge({
      vector,
      topK: config.ragRetrievalTopK,
      filters: input.filters,
      authorization: input.authorization,
      traceId: input.traceId,
      signal,
    });
    if (candidates.length === 0) {
      return [];
    }
    const ranked = await modelServerClient.rerank(
      input.query,
      candidates.map((candidate) => candidate.content),
      config.ragFinalTopK,
      signal,
    );
    return ranked
      .filter((result) => result.score >= config.ragMinRerankScore)
      .map((result) => ({
        ...candidates[result.index],
        rerankScore: result.score,
      }));
  } catch (error) {
    console.warn("knowledge retrieval degraded", {
      traceId: input.traceId,
      error: error instanceof Error ? error.message : "unknown error",
    });
    return [];
  }
}
