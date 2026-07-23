# customer-ops-backend

智能客服系统的**账号与订单服务**（Rust）。提供用户登录，并对已验证身份校验订单归属、返回最少订单字段，供 model-api 在生成客服回答前取得可信实时订单数据。整体设计见 [../../docs/README.md](../../docs/README.md)，开发规格见 [../../specs/1.backend-order-service/](../../specs/1.backend-order-service/)。

## 技术栈

- Rust + Axum + tokio；Clean Architecture 四层（handler / application / domain / infra）
- SeaORM + Neon PostgreSQL
- JWT HS256 鉴权（MVP 测试身份，`TokenVerifier` trait 可换 JWKS/真实 IdP）

## 代码结构

- `main.rs`：最小本地入口。
- `lib.rs`：提供可复用的 `build_app(&Config)`，供本地 Server、测试及未来 Lambda 入口共享。
- `runtime.rs`：环境、日志、监听端口与优雅关闭。
- `bootstrap.rs`：数据库、迁移和应用依赖装配。
- `router.rs`：路由与全局中间件集中配置。
- `handler / application / domain / infra`：HTTP 边界、用例、领域抽象和基础设施实现，依赖只向内。

## 统一响应

所有 JSON 接口返回 `{code, success, msg, data}`，`code=200`（`success=true`）为成功，失败 `data=null`。

业务错误码：`40001` 请求参数错误 / `40101` 未授权 / `40301` 无权访问 / `40401` 订单不存在 / `50301` 订单服务不可用 / `50000` 内部错误。

## 接口

| 方法 | 路径                                             | 认证           | 说明                             |
| ---- | ------------------------------------------------ | -------------- | -------------------------------- |
| POST | `/api/auth/login`                                | 无             | 校验账号密码并签发 JWT           |
| GET  | `/api/orders/{orderId}`                          | Bearer（必需） | 查询有权访问的订单最小字段       |
| POST | `/api/conversations/{conversationId}/complete`   | Bearer（必需） | 记录对话完成并发布 SNS 事件（幂等）|
| GET  | `/api/health`                                    | 无             | 健康检查                         |

> 契约提示：model-api 现期望扁平订单 JSON，本服务统一封装后订单在 `data` 内；`/complete` 端点契约为本项目自定 —— 均由 model-api 后续适配（见 specs/LESSONS.md）。

## 本地运行

```bash
cp .env.example .env   # 填入 Neon DATABASE_URL 与 AUTH_JWT_SECRET
cargo run              # 启动时自动应用 migration
```

Migration 只负责表结构与订单演示数据，不在源码中预置登录账号。账号必须通过受控的数据库管理流程创建。

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"username":"<username>","password":"<password>"}' \
  http://localhost:8080/api/auth/login
curl -H "Authorization: Bearer <login response accessToken>" \
  http://localhost:8080/api/orders/<owned-order-id>
curl http://localhost:8080/api/health
```

## 常用命令

```bash
cargo run                                   # 开发运行
cargo build --release                       # 构建
cargo fmt --all                             # 格式化
cargo clippy --all-targets -- -D warnings   # Lint
cargo test                                  # 测试
```

## SNS 事件（可选 feature）

对话完成事件发布默认走 `NoopPublisher`（只记日志，本地无需 AWS）。启用真实 SNS：

```bash
cargo build --features sns   # 需 rustc ≥ 1.94.1（aws-sdk-sns 最新版 MSRV）
```

并设置 `SNS_TOPIC_ARN` 与 AWS 凭证（IAM Role/环境）。未启用 `sns` feature 时即便设了 ARN 也回退 no-op。

## 部署

生产打包为 API Gateway REST API + Lambda（`lambda_http`）；Lambda 连 Neon `-pooler` 端点并用小连接池，关闭底层 prepared statement 缓存（见 [.claude/rules/database.md](../../.claude/rules/database.md)）。
