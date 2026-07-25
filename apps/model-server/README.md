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

## AWS 部署

生产镜像使用 CUDA 12.8 和 `llama-cpp-python` GPU 后端。ECS Service 必须运行
在带 NVIDIA GPU 的 ECS EC2 Capacity Provider 上，不能使用 Fargate。
Task Definition 的模型容器还必须声明一个 GPU：

```json
{"resourceRequirements":[{"type":"GPU","value":"1"}]}
```

GGUF 不打入镜像。容器启动时，如果 `MODEL_PATH` 不存在，会使用 ECS Task
Role 从以下地址下载：

```text
s3://customer-ops-models/models/customer-ops/customer-ops-q4_k_m.gguf
```

Task Definition 至少配置：

```text
MODEL_S3_URI=s3://customer-ops-models/models/customer-ops/customer-ops-q4_k_m.gguf
MODEL_PATH=/models/customer-ops-q4_k_m.gguf
MODEL_HOST=0.0.0.0
MODEL_PORT=8000
MODEL_SERVER_API_KEY=<Secrets Manager 注入>
```

可选配置 `MODEL_SHA256`，启动时会在加载模型前核对摘要。Task Role 只需要
对上述单个对象的 `s3:GetObject` 权限。

Python Service 不创建公网 Load Balancer，也不分配公网 IP。它的 Security
Group 仅允许 Mastra Task Security Group 访问 TCP 8000。API Key 是第二层
防护，不能代替这条网络规则。

提交 `apps/model-server/**` 到 `main` 后，
`.github/workflows/model-server-ecs.yml` 会构建 GPU 镜像、推送 ECR，并滚动
更新已有 ECS Service。Pull Request 只安装依赖并执行测试。
