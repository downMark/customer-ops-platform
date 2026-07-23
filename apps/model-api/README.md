# Customer Ops Model API

基于 Mastra 的客服模型 API。服务先通过 HTTP 从后端取得可信订单数据，再调用 `apps/model-server` 中直接加载 GGUF 的 FastAPI 服务，最后通过 SSE 将回答返回前端。运行链路不依赖 Ollama。

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

登录由 model-api 代理至 backend；订单查询必须验证转发的 Bearer Token 和订单归属，不能信任 model-api 提交的用户身份字段。

## 验证

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```
