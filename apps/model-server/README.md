# Customer Ops Model Server

FastAPI 推理服务，使用 `llama-cpp-python` 直接加载客服 GGUF 模型，不依赖 Ollama。

同一进程通过 ONNX Runtime 加载 `bge-m3` 和
`bge-reranker-v2-m3`，提供知识检索所需的 embedding 与 rerank。三个引擎
共享推理锁，避免生成、embedding 和 rerank 同时产生峰值工作区。

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

第一次启动需要把约 5GB 模型加载到内存。默认使用 CPU；Mac 如需 Metal
加速，可在本地显式设置 `MODEL_GPU_LAYERS=-1` 并安装支持 Metal 的构建。

## 接口

- `GET /health`：模型服务健康状态。
- `GET /v1/models`：OpenAI-compatible 模型列表。
- `POST /v1/chat/completions`：OpenAI-compatible 对话与流式生成。
- `POST /v1/embeddings`：生成 1024 维归一化向量。
- `POST /v1/rerank`：对 query/document pairs 进行相关性排序。
- `GET /docs`：FastAPI OpenAPI 页面。

除 `/health` 和 `/docs` 外，请求需要：

```http
Authorization: Bearer <MODEL_SERVER_API_KEY>
```

## 测试

```bash
uv run pytest
```

## AWS 部署

Dockerfile 提供两个显式目标：

- `gpu-runtime`：生产默认，使用 CUDA 12.6，并针对 T4 的 compute capability
  7.5 编译 `llama-cpp-python`。
- `cpu-runtime`：仅用于切回 Fargate 前的安全回退。

生产 ECS Service 默认放置到 `g4dn.xlarge` GPU capacity provider，分配一张
NVIDIA T4 16 GiB，并设置 `MODEL_GPU_LAYERS=-1`。

GGUF 不打入镜像。容器启动时，如果 `MODEL_PATH` 不存在，会使用 ECS Task
Role 从以下地址下载：

```text
s3://customer-ops-models/models/customer-ops/customer-ops-q4_k_m.gguf
```

Task Definition 至少配置：

```text
MODEL_S3_URI=s3://customer-ops-models/models/customer-ops/customer-ops-q4_k_m.gguf
MODEL_PATH=/models/customer-ops-q4_k_m.gguf
EMBEDDING_MODEL_S3_URI=s3://customer-ops-models/models/customer-ops/bge-m3-onnx/
RERANK_MODEL_S3_URI=s3://customer-ops-models/models/customer-ops/bge-reranker-v2-m3-onnx/
EMBEDDING_MODEL_PATH=/models/bge-m3-onnx/model.onnx
RERANK_MODEL_PATH=/models/bge-reranker-v2-m3-onnx/model.onnx
MODEL_HOST=0.0.0.0
MODEL_PORT=8000
MODEL_GPU_LAYERS=-1
MODEL_THREADS=4
MODEL_DISABLE_THINKING=true
MODEL_SERVER_API_KEY=<Secrets Manager 注入>
```

`MODEL_DISABLE_THINKING=true` 会在 Qwen3 assistant prompt 中预填空的
thinking block，使 OpenAI-compatible `content` 立即开始输出；客服链路不生成
或暴露隐藏思考内容。

可选配置 `MODEL_SHA256`，启动时会在加载 GGUF 前核对摘要。两个 ONNX
目录使用各自的 `SHA256SUMS` 逐文件校验。Task Role 需要限定到
`models/customer-ops/*` 的对象读取和同前缀 ListBucket 权限。

Python Service 仅连接内部 NLB。GPU 容器实例位于当前无 NAT 的公共子网，
通过实例出站网络访问 ECR 和 S3；Security Group 入站只允许 Mastra Task
Security Group 和内部 NLB 健康检查访问 TCP 8000。API Key 是第二层防护，
不能代替网络规则。

`.github/workflows/model-server-ecs.yml` 仅支持手动运行。正常发布选择
`image_variant=gpu`；只有在准备把基础设施切回 Fargate 时，才先选择
`image_variant=cpu`。Pull Request 和 push 均不会自动发布。
