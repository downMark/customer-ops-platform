import { z } from "zod";

const positiveInteger = z.coerce.number().int().positive();

const envSchema = z.object({
  MODEL_SERVER_BASE_URL: z.string().url().default("http://127.0.0.1:8000/v1"),
  MODEL_SERVER_MODEL: z.string().min(1).default("customer-ops"),
  MODEL_SERVER_API_KEY: z.string().min(1).default("local-model-server"),
  BACKEND_BASE_URL: z.string().url().default("http://127.0.0.1:8080"),
  BACKEND_TIMEOUT_MS: positiveInteger.default(5_000),
  MODEL_TIMEOUT_MS: positiveInteger.default(120_000),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3002"),
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
  backendBaseUrl: parsed.data.BACKEND_BASE_URL.replace(/\/$/, ""),
  backendTimeoutMs: parsed.data.BACKEND_TIMEOUT_MS,
  modelTimeoutMs: parsed.data.MODEL_TIMEOUT_MS,
  corsOrigins: parsed.data.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};
