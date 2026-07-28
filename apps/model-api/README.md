# Customer Ops Model API

基于 Mastra 的客服模型 API。服务先通过 HTTP 从后端取得可信订单数据，再调用 `apps/model-server` 中直接加载 GGUF 的 FastAPI 服务，最后通过 SSE 将回答返回前端。运行链路不依赖 Ollama。

聊天前会并行执行知识检索：`embed → backend top-K → rerank → top-3`。
知识链路在超时、503 或契约错误时降级为空资料，不影响原有客服回答。

## 启动

先启动直接加载 GGUF 的模型服务：

```bash
cd ../model-server
cp .env.example .env
uv sync
uv run --env-file .env python -m app
```

再启动 Mastra：

```bash
cd ../model-api
cp .env.example .env
corepack pnpm install
corepack pnpm check:model-server
corepack pnpm dev
```

默认地址为 `http://localhost:4111`。

## 业务接口

- `GET /api/health`：检查 backend、FastAPI model-server 和目标模型。
- `POST /api/auth/login`：代理 backend 登录并返回聊天使用的 JWT。
- `POST /api/chat/stream`：查询订单并流式生成客服回答。
- `/_mastra/*`：Mastra Studio 和内部开发接口，不提供给业务前端。

先登录，再把响应中的 `accessToken` 用于聊天：

```bash
curl http://localhost:4111/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<username>","password":"<password>"}'

curl -N http://localhost:4111/api/chat/stream \
  -H 'Authorization: Bearer <accessToken>' \
  -H 'Content-Type: application/json' \
  -d '{
    "conversationId": "conv-123",
    "orderId": "ADMIN-2026-0006",
    "message": "我的订单现在到哪里了？"
  }'
```

`BACKEND_BASE_URL` 指向的后端需要实现：

- `GET /api/health`
- `POST /api/auth/login`
- `GET /api/orders/:orderId`
- `POST /api/knowledge/search`

登录由 model-api 代理至 backend；订单查询必须验证转发的 Bearer Token 和订单归属，不能信任 model-api 提交的用户身份字段。

## 验证

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

## AWS 部署

生产镜像由 `Dockerfile` 构建，监听 `0.0.0.0:4111`。服务部署到 ECS 后通过
公网 HTTPS ALB 提供给前端，ALB 的 4111 端口只转发到 Mastra Task
Security Group。

Task Definition 必须配置：

- `MODEL_SERVER_BASE_URL`：私有 Python model-server 地址，例如
  `http://model-server.internal:8000/v1`。
- `MODEL_SERVER_API_KEY`：从 Secrets Manager 注入，必须与 Python 服务一致。
- `BACKEND_BASE_URL`：Backend Lambda 的 API Gateway 地址。
- `RAG_ENABLED`：是否启用知识检索，默认 `true`。
- `RAG_RETRIEVAL_TOP_K` / `RAG_FINAL_TOP_K`：候选数与最终资料数。
- `RAG_MIN_RERANK_SCORE`：最低相关性分数，默认 `0.1`。
- `RAG_TIMEOUT_MS`：整条知识链路超时，默认 8000ms。
- `RAG_RETRIEVAL_TOP_K`：Neon 向量召回数量，默认 20。
- `RAG_RERANK_TOP_K`：送入 CPU reranker 的候选数量，默认 3。
- `RAG_FINAL_TOP_K`：最终注入 prompt 的资料数量，默认 3。
- `CORS_ORIGINS`：仅包含实际 Cloudflare 前端域名。

提交 `apps/model-api/**` 到 `main` 后，
`.github/workflows/model-api-ecs.yml` 会构建不可变 SHA 镜像、推送 ECR，
并滚动更新已有 ECS Service。工作流仅支持手动运行，Pull Request 和 push 均不会触发。
