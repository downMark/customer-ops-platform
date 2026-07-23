const baseUrl = (
  process.env.MODEL_SERVER_BASE_URL ?? "http://127.0.0.1:8000/v1"
).replace(/\/$/, "");
const model = process.env.MODEL_SERVER_MODEL ?? "customer-ops";
const apiKey = process.env.MODEL_SERVER_API_KEY ?? "local-model-server";

try {
  const response = await fetch(`${baseUrl}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const payload = await response.json();
  const models = Array.isArray(payload.data)
    ? payload.data.map((item) => item.id).filter(Boolean)
    : [];
  if (!models.includes(model)) {
    throw new Error(`没有找到模型 ${model}；当前模型：${models.join(", ")}`);
  }

  console.log(`FastAPI 模型服务连接正常，模型 \"${model}\" 已就绪。`);
} catch (error) {
  console.error(
    `FastAPI 模型服务检查失败：${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
}
