import { z } from "zod";

const positiveInteger = z.coerce.number().int().positive();
const envBoolean = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(["true", "false", "1", "0", "yes", "no"]))
  .transform((value) => ["true", "1", "yes"].includes(value));

const envSchema = z.object({
  MODEL_SERVER_BASE_URL: z.string().url().default("http://127.0.0.1:8000/v1"),
  MODEL_SERVER_MODEL: z.string().min(1).default("customer-ops"),
  MODEL_SERVER_API_KEY: z.string().min(1).default("local-model-server"),
  EMBEDDING_MODEL: z.string().min(1).default("bge-m3"),
  RERANK_MODEL: z.string().min(1).default("bge-reranker-v2-m3"),
  BACKEND_BASE_URL: z.string().url().default("http://127.0.0.1:8080"),
  BACKEND_TIMEOUT_MS: positiveInteger.default(5_000),
  MODEL_TIMEOUT_MS: positiveInteger.default(120_000),
  RAG_ENABLED: envBoolean.default("true"),
  RAG_RETRIEVAL_TOP_K: positiveInteger.max(50).default(20),
  RAG_RERANK_TOP_K: positiveInteger.max(20).default(3),
  RAG_FINAL_TOP_K: positiveInteger.max(20).default(3),
  RAG_MIN_RERANK_SCORE: z.coerce.number().min(0).max(1).default(0.1),
  RAG_TIMEOUT_MS: positiveInteger.default(8_000),
  RAG_MAX_CONTEXT_CHARS: positiveInteger.default(6_000),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3002"),
  APP_ENVIRONMENT: z.string().min(1).default("local"),
  APP_RELEASE: z.string().min(1).default("development"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`环境变量配置无效：${details}`);
}

export const config = {
  modelServerBaseUrl: parsed.data.MODEL_SERVER_BASE_URL.replace(/\/$/, ""),
  modelServerModel: parsed.data.MODEL_SERVER_MODEL,
  modelServerApiKey: parsed.data.MODEL_SERVER_API_KEY,
  embeddingModel: parsed.data.EMBEDDING_MODEL,
  rerankModel: parsed.data.RERANK_MODEL,
  backendBaseUrl: parsed.data.BACKEND_BASE_URL.replace(/\/$/, ""),
  backendTimeoutMs: parsed.data.BACKEND_TIMEOUT_MS,
  modelTimeoutMs: parsed.data.MODEL_TIMEOUT_MS,
  ragEnabled: parsed.data.RAG_ENABLED,
  ragRetrievalTopK: parsed.data.RAG_RETRIEVAL_TOP_K,
  ragRerankTopK: parsed.data.RAG_RERANK_TOP_K,
  ragFinalTopK: parsed.data.RAG_FINAL_TOP_K,
  ragMinRerankScore: parsed.data.RAG_MIN_RERANK_SCORE,
  ragTimeoutMs: parsed.data.RAG_TIMEOUT_MS,
  ragMaxContextChars: parsed.data.RAG_MAX_CONTEXT_CHARS,
  corsOrigins: parsed.data.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  environment: parsed.data.APP_ENVIRONMENT,
  release: parsed.data.APP_RELEASE,
};
