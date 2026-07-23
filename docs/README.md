# 智能客服系统设计与实施文档

## 1. 项目目标

本项目实现一个可以查询实时订单信息的智能客服系统。

用户在前端聊天页面提交问题和订单号；前端调用 Mastra 服务；Mastra 通过 HTTP 调用后端订单服务取得可信的实时订单数据，再将用户问题、订单数据和客服规则交给 FastAPI 模型服务。FastAPI 使用 `llama-cpp-python` 直接加载自训练产物 `customer-ops-q4_k_m.gguf`，最后把模型回答流式返回前端。

项目还必须完成三项 AWS 技术任务：

1. CloudWatch Synthetics 自动巡检。
2. SNS、SQS 和死信队列业务场景。
3. API Gateway REST API Canary 灰度发布与回滚。

## 2. MVP 范围

### 包含

- 客户聊天页面。
- 流式显示模型回复。
- Mastra 对话编排服务。
- 通过 FastAPI + `llama-cpp-python` 直接调用 GGUF 自训练模型。
- 通过后端 HTTP API 查询订单。
- 后端执行身份校验、订单归属校验和数据库查询。
- 保存必要的对话完成记录。
- 对话完成事件通过 SNS 分发到 SQS。
- SQS 消费失败后进入 DLQ，并支持 redrive。
- CloudWatch Synthetics 健康检查和完整聊天链路巡检。
- API Gateway Canary 灰度发布、指标观察和回滚。
- 使用基础设施代码创建 AWS 资源。

### 暂不包含

- 完整客服工作台和人工接管系统。
- 多租户管理后台。
- RAG、知识库和向量数据库。
- MCP Server 和高风险写操作。
- 退款、取消订单、修改地址等实际业务操作。
- 多模型路由和云端备用模型。
- Monorepo、共享 packages、Rust crates 或统一 Workspace。

## 3. 项目目录

各部分是相互独立的应用，不使用 pnpm workspace、Turborepo 或 Cargo Workspace。

```text
customer-ops-platform/
├── apps/
│   ├── frontend/       # 客服聊天页面
│   ├── model-api/      # Mastra 编排、后端调用和模型调用
│   ├── model-server/   # FastAPI 直接加载 GGUF
│   ├── backend/        # 订单 API、鉴权和数据库访问
│   └── event-worker/   # SQS 消费者
├── infra/              # AWS CloudFormation 与部署脚本
├── docs/
│   ├── README.md
│   └── assets/
└── README.md
```

每个应用拥有自己的依赖、环境变量、测试和启动命令。应用之间只通过 HTTP API 或 AWS 消息进行通信。

## 4. 系统架构

```mermaid
flowchart LR
    User[客户] --> Frontend[frontend\n聊天页面]
    Frontend -->|POST /api/chat/stream| Mastra[model-api\nMastra]
    Mastra -->|HTTP 查询订单| Backend[backend\n订单服务]
    Backend --> Database[(订单数据库)]
    Backend -->|结构化订单 JSON| Mastra
    Mastra -->|OpenAI 兼容 API| ModelServer[FastAPI model-server]
    ModelServer -->|llama-cpp-python| GGUF[customer-ops-q4_k_m.gguf]
    GGUF -->|生成内容| Mastra
    Mastra -->|SSE 流式回复| Frontend
    Backend --> SNS[SNS\ndomain-events]
    SNS --> QualityQueue[SQS\nquality-jobs]
    SNS --> AnalyticsQueue[SQS\nanalytics-jobs]
    QualityQueue --> Worker[event-worker]
    AnalyticsQueue --> Worker
    QualityQueue --> QualityDLQ[SQS DLQ]
    AnalyticsQueue --> AnalyticsDLQ[SQS DLQ]
```

### 服务职责

| 服务           | 职责                                                         | 不负责                           |
| -------------- | ------------------------------------------------------------ | -------------------------------- |
| `frontend`     | 收集问题和订单号、发送请求、展示流式回复和错误状态           | 不直接访问数据库或模型服务       |
| `model-api`    | Mastra 编排、调用后端、构造模型上下文、调用模型服务、流式响应 | 不直接访问数据库，不加载模型权重 |
| `model-server` | FastAPI 接口、加载 GGUF、执行推理和输出 OpenAI 兼容流        | 不查询订单，不包含业务权限规则   |
| `backend`      | 验证身份、校验订单归属、查询订单、保存业务记录、发布领域事件 | 不负责生成客服回答               |
| `event-worker` | 消费质量评估和分析任务，处理重试、幂等和部分批次失败         | 不参与用户同步等待链路           |
| `infra`        | 创建、更新和删除 AWS 资源，配置告警与灰度发布                | 不包含业务代码                   |

## 5. 核心聊天流程

1. 用户在前端输入订单号和问题。
2. 前端创建 `trace_id` 或接收入口返回的 `trace_id`，调用 `model-api`。
3. `model-api` 校验请求格式，并把用户身份凭证和 `trace_id` 转发给 `backend`。
4. `backend` 从可信身份中确定用户，校验该用户是否有权查看目标订单。
5. `backend` 查询数据库并返回结构化订单 JSON；未找到或无权访问时返回明确错误，不返回其他客户的数据。
6. `model-api` 将用户问题、订单 JSON 和客服规则提交给 FastAPI `model-server`。
7. `model-server` 使用 `llama-cpp-python` 直接调用 `customer-ops-q4_k_m.gguf`。
8. 模型只负责组织客服回答，不负责决定数据权限，也不能声称执行了退款、取消订单等操作。
9. `model-api` 使用 SSE 将生成内容流式返回前端。
10. 对话成功结束后，`backend` 保存完成记录并向 SNS 发布 `ConversationCompleted` 事件。

### 故障处理

- 后端超时：不调用模型猜测订单状态，返回“订单服务暂时不可用”。
- 订单不存在：明确返回未找到，不提供推测结果。
- 无权访问：返回统一权限错误，不泄露订单是否属于其他用户。
- FastAPI 模型服务不可用：返回可重试错误和 `trace_id`。
- 用户停止生成：前端取消请求，`model-api` 中止模型服务调用。
- 客户端断线：停止本次流；首版不保证断点续传。

## 6. HTTP 接口契约

### 6.1 前端调用 model-api

```http
POST /api/chat/stream
Authorization: Bearer <access-token>
Content-Type: application/json
Accept: text/event-stream
X-Trace-Id: <optional-trace-id>
```

请求：

```json
{
  "conversationId": "conv_123",
  "orderId": "COP-10086",
  "message": "我的订单现在到哪里了？"
}
```

SSE 事件：

```text
event: start
data: {"traceId":"trace_123"}

event: delta
data: {"text":"您的订单目前"}

event: done
data: {"conversationId":"conv_123"}
```

失败时返回：

```text
event: error
data: {"code":"ORDER_SERVICE_UNAVAILABLE","message":"订单服务暂时不可用","traceId":"trace_123"}
```

### 6.2 model-api 调用 backend

```http
GET /api/orders/{orderId}
Authorization: Bearer <forwarded-access-token>
X-Trace-Id: <trace-id>
```

成功响应：

```json
{
  "orderId": "COP-10086",
  "status": "shipped",
  "statusText": "已发货",
  "carrier": "测试物流",
  "trackingNumber": "TEST-10086",
  "estimatedDeliveryAt": "2026-07-25T18:00:00Z",
  "updatedAt": "2026-07-22T12:00:00Z"
}
```

后端只返回回答当前问题所需的最少字段，不向模型提供支付凭证、完整地址或其他敏感信息。

### 6.3 健康检查

每个服务提供：

```http
GET /api/health
```

`model-api` 额外提供依赖状态，但不得在响应中暴露密钥、内部地址或模型文件路径：

```json
{
  "status": "ok",
  "dependencies": {
    "backend": "ok",
    "modelServer": "ok",
    "model": "customer-ops"
  }
}
```

## 7. 自训练模型与 FastAPI

训练链路已经完成：以 Qwen3-8B 为基座完成 QLoRA 微调，将 Adapter 与基座合并，转换成 GGUF 并量化为 Q4_K_M。运行时由 FastAPI + `llama-cpp-python` 直接加载 GGUF；Ollama 仅用于模型产物的独立验证，不属于正式调用链。

| 项目          | 当前结果                 |
| ------------- | ------------------------ |
| 基座模型      | Qwen3-8B                 |
| 训练方式      | 4-bit QLoRA / NF4 / LoRA |
| 训练框架      | LLaMA-Factory            |
| 本地格式      | GGUF Q4_K_M              |
| GGUF 路径     | `/Volumes/T7/customer-ops-model/customer-ops-q4_k_m.gguf` |
| 模型别名      | `customer-ops`           |
| FastAPI 地址  | `http://127.0.0.1:8000`  |

模型中只训练客服语气、回答结构、业务规则和异常处理方式。订单、物流、退款和库存等实时事实必须由后端查询，不得训练进模型或由模型猜测。

Mastra 使用 FastAPI 的 OpenAI 兼容接口：

```text
http://127.0.0.1:8000/v1
```

生产环境中 `model-server` 运行在受控 GPU 主机或企业私网中，必须配置服务密钥，不能把未鉴权的模型端口暴露到公网。

## 8. AWS 部署边界

推荐的 AWS 演示环境：

| 组件           | 部署方式                                   |
| -------------- | ------------------------------------------ |
| `backend`      | API Gateway REST API + Lambda              |
| `event-worker` | Lambda，由 SQS Event Source Mapping 触发   |
| SNS/SQS/DLQ    | AWS 托管服务                               |
| `model-api`    | ECS/Fargate 或 EC2，支持持续连接与流式响应 |
| `model-server` | GPU EC2，FastAPI + CUDA 版 llama-cpp-python |
| Synthetics     | CloudWatch Synthetics                      |
| 基础设施       | CloudFormation                             |

本地开发时，`frontend`、`model-api`、`model-server` 和 `backend` 均可在开发机运行。AWS 的完整聊天巡检只有在 `model-api` 和 `model-server` 可从巡检环境访问时才能通过。

## 9. CloudWatch Synthetics 巡检

### 9.1 健康巡检

创建 `cop-api-health` Canary：

- 每 5 分钟执行。
- 调用公开的 `/api/health`。
- 断言 HTTP 200、`status = ok` 和响应时间阈值。
- 连续两次失败触发 CloudWatch Alarm。
- 告警发送到运维 SNS Topic。

### 9.2 完整聊天巡检

创建 `cop-chat-journey` Canary：

- 每 15 分钟执行。
- 使用专用测试身份和固定测试订单。
- 调用 `/api/chat/stream`。
- 断言收到 `traceId`、至少一个 `delta` 和最终 `done`。
- 验证回答包含测试订单的预期状态，但不要求逐字匹配。
- 不记录 Authorization、完整响应正文或真实客户数据。

### 9.3 验收证据

- CloudFormation 中的 Canary、IAM Role、S3 制品位置和 Alarm。
- 一次成功运行记录。
- 一次受控失败和告警记录。
- 故障修复后的恢复记录。

## 10. SNS、SQS 与死信队列

### 10.1 业务场景

`backend` 在对话完成记录保存成功后发布：

```json
{
  "eventId": "evt_123",
  "eventType": "ConversationCompleted",
  "occurredAt": "2026-07-22T12:00:00Z",
  "traceId": "trace_123",
  "conversationId": "conv_123",
  "orderId": "COP-10086",
  "schemaVersion": 1
}
```

SNS 分发到两个独立队列：

```text
cop-domain-events SNS
├── cop-quality-jobs SQS   → 客服回答质量评估
└── cop-analytics-jobs SQS → 对话数量和延迟统计
```

每个主队列配置自己的 DLQ，`maxReceiveCount = 5`。DLQ 保留时间必须长于主队列，DLQ 出现可见消息时触发告警。

### 10.2 消费规则

- 消费者按至少一次投递设计。
- 使用 `eventId + consumerName` 作为幂等键。
- Lambda Event Source Mapping 开启 `ReportBatchItemFailures`。
- 单条 poison message 不得导致同批成功消息重复处理。
- Lambda timeout 小于 SQS visibility timeout。
- redrive 前先修复失败原因，再以受控速度重新投递。

### 10.3 验收演示

1. 发布正常事件并验证两个消费者成功处理。
2. 发布带 `testPoison = true` 的测试事件。
3. 验证消息重试 5 次后进入对应 DLQ。
4. 关闭测试失败条件。
5. 将消息从 DLQ redrive 回主队列。
6. 验证业务副作用只执行一次，并能通过 `traceId` 串联日志。

## 11. API Gateway Canary 灰度发布

Canary 的目标是部署在 API Gateway REST API 后面的 `backend`。旧版和新版通过同一个 `prod` Stage 对外服务。

推荐发布过程：

```text
部署新版到 Canary
  → 5% 流量，观察 10 分钟
  → 20% 流量，观察 20 分钟
  → 50% 流量，观察 20 分钟
  → 100% 并提升为正式版本
```

低流量环境由 Synthetics 和受控测试请求补充样本。每个阶段检查：

- API Gateway 5xx。
- Lambda Error 和 Throttle。
- P95 响应时间。
- 健康与完整聊天 Synthetics 成功率。
- Mastra 调用后端的失败率。
- DLQ 是否出现新增消息。

任一关键告警触发时，将 Canary 流量恢复为 0%，保留失败版本及日志用于诊断。数据库和接口变更必须向后兼容，保证灰度期间新旧版本能够同时运行。

验收需要保存 5%、20% 和 100% 阶段的配置与指标，并演示一次模拟故障回滚。

## 12. 安全与可观测性

- 所有公网请求必须使用 HTTPS。
- `backend` 不信任前端传入的用户 ID，必须从已验证身份中取得用户信息。
- `model-api` 只向模型提供回答所需的最少订单字段。
- 密钥存入 AWS Secrets Manager、SSM Parameter Store 或部署平台的 Secret，不进入源码。
- `trace_id` 贯穿前端、Mastra、后端、SNS、SQS 和消费者。
- 日志默认脱敏 Authorization、电话、地址和物流敏感字段。
- 记录请求量、错误率、P95 延迟、模型首字延迟、完整生成耗时、后端查询失败率和 DLQ 数量。
- 模型输出视为不可信文本，不允许直接触发数据库写入或高风险操作。

## 13. 实施顺序

### 阶段一：本地业务闭环

1. 建立 `frontend`、`model-api` 和 `backend` 三个独立应用。
2. `backend` 先使用测试订单数据，实现身份与订单归属校验接口。
3. `model-api` 接入 `customer-ops`，实现后端查询和 SSE 输出。
4. `frontend` 实现订单号输入、聊天输入、流式显示、停止生成和错误提示。

完成标准：输入固定测试订单后，页面能展示基于后端实时数据生成的客服回答；后端不可用时模型不会编造订单状态。

### 阶段二：AWS 异步任务

1. 保存对话完成记录并发布 SNS 事件。
2. 建立 quality 和 analytics 两个 SQS 队列及各自 DLQ。
3. 实现 `event-worker` 的幂等消费和部分批次失败。
4. 完成 poison message、DLQ 和 redrive 演示。

### 阶段三：AWS 部署与灰度

1. 使用 CloudFormation 部署 backend Lambda 和 API Gateway REST API。
2. 配置 Stage Canary、日志、指标和自动/手动回滚脚本。
3. 部署可被 `model-api` 访问的后端环境。
4. 完成 5%、20%、50%、100% 灰度验证。

### 阶段四：巡检和验收

1. 创建健康检查 Canary。
2. 创建完整聊天链路 Canary。
3. 配置 CloudWatch Alarm 和运维 SNS 通知。
4. 收集成功、失败、告警、DLQ、redrive、灰度和回滚证据。

## 14. MVP 验收标准

- 前端可以提交订单号和问题，并看到流式回答。
- Mastra 必须先从后端取得订单数据，再调用 `customer-ops` 模型。
- 无订单、无权限或后端失败时，模型不编造事实。
- FastAPI 模型服务不可用时前端收到明确错误和 `trace_id`。
- 正常对话完成后能够产生 SNS 事件，并被两个 SQS 消费者接收。
- poison message 重试后进入 DLQ，修复后能够 redrive 且无重复副作用。
- API Gateway 能完成 5% 到 100% 的 Canary 发布，并能在异常时回滚到 0%。
- CloudWatch Synthetics 能持续验证健康接口和完整聊天链路。
- 所有 AWS 资源均由 CloudFormation 重复创建，不依赖控制台手工配置。
