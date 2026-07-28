import { config } from "../config";
import type {
  KnowledgeFilters,
  KnowledgeReference,
} from "../contracts/knowledge";
import { withTimeout } from "../lib/signals";
import {
  performanceClient,
  requestTraceContext,
} from "../performance";
import { formatTraceparent } from "../performance-sdk";
import { backendClient } from "./backend-client";
import { modelServerClient } from "./model-server-client";

type RetrieveKnowledgeInput = {
  query: string;
  authorization: string;
  traceId: string;
  traceparent?: string;
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
  const span = performanceClient.startSpan("rag.retrieve", {
    parent: requestTraceContext(input.traceparent),
    attributes: { component: "rag" },
  });
  const traceparent = formatTraceparent(span.context);
  try {
    const vector = await modelServerClient.embed(input.query, signal, traceparent);
    const candidates = await backendClient.searchKnowledge({
      vector,
      topK: config.ragRetrievalTopK,
      filters: input.filters,
      authorization: input.authorization,
      traceId: input.traceId,
      traceparent,
      signal,
    });
    if (candidates.length === 0) {
      span.finish("ok");
      return [];
    }
    const rerankCandidates = candidates.slice(0, config.ragRerankTopK);
    const ranked = await modelServerClient.rerank(
      input.query,
      rerankCandidates.map((candidate) => candidate.content),
      config.ragFinalTopK,
      signal,
      traceparent,
    );
    const result = ranked
      .filter((result) => result.score >= config.ragMinRerankScore)
      .map((result) => ({
        ...rerankCandidates[result.index],
        rerankScore: result.score,
      }));
    span.finish("ok");
    return result;
  } catch (error) {
    span.finish(error instanceof Error && error.name === "AbortError"
      ? "cancelled" : "error");
    performanceClient.captureError("rag.retrieve", error, span.context);
    console.warn("knowledge retrieval degraded", {
      traceId: input.traceId,
      error: error instanceof Error ? error.message : "unknown error",
    });
    return [];
  }
}
