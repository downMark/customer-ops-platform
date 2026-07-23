# Customer Ops Model Server

FastAPI 推理服务，使用 `llama-cpp-python` 直接加载客服 GGUF 模型，不依赖 Ollama。

## 模型

默认直接加载：

```text
/Volumes/T7/customer-ops-model/customer-ops-q4_k_m.gguf
```

## 安装与启动

```bash
cp .env.example .env
uv sync
uv run --env-file .env python -m app
```

第一次启动需要把约 5GB 模型加载到内存。Mac 使用 `MODEL_GPU_LAYERS=-1` 尽可能通过 Metal 加速。

## 接口

- `GET /health`：模型服务健康状态。
- `GET /v1/models`：OpenAI-compatible 模型列表。
- `POST /v1/chat/completions`：OpenAI-compatible 对话与流式生成。
- `GET /docs`：FastAPI OpenAPI 页面。

除 `/health` 和 `/docs` 外，请求需要：

```http
Authorization: Bearer <MODEL_SERVER_API_KEY>
```

## 测试

```bash
uv run pytest
```
