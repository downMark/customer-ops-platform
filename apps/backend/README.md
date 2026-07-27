# customer-ops-backend

智能客服系统的**账号与订单服务**（Rust）。提供用户登录，并对已验证身份校验订单归属、返回最少订单字段，供 model-api 在生成客服回答前取得可信实时订单数据。整体设计见 [../../docs/README.md](../../docs/README.md)，开发规格见 [../../specs/1.backend-order-service/](../../specs/1.backend-order-service/)。

## 技术栈

- Rust + Axum + tokio；Clean Architecture 四层（handler / application / domain / infra）
- SeaORM + Neon PostgreSQL
- JWT HS256 鉴权（MVP 测试身份，`TokenVerifier` trait 可换 JWKS/真实 IdP）

## 代码结构

- `main.rs`：最小本地入口。
- `lib.rs`：提供可复用的 `build_app(&Config)`，供本地 Server、测试及 Lambda 入口共享。
- `runtime.rs`：环境、日志、监听端口与优雅关闭。
- `src/bin/lambda.rs`：AWS Lambda HTTP 入口，只在启用 `lambda` feature 时编译。
- `bootstrap.rs`：数据库、迁移和应用依赖装配。
- `router.rs`：路由与全局中间件集中配置。
- `handler / application / domain / infra`：HTTP 边界、用例、领域抽象和基础设施实现，依赖只向内。

## 统一响应

所有 JSON 接口返回 `{code, success, msg, data}`，`code=200`（`success=true`）为成功，失败 `data=null`。

除通用错误码外，商品与库存相关错误码为：`40002` 商品不存在或已停用 /
`40302` 仅管理员可操作 / `40902` 库存不足 / `40903` 商品编号冲突。

## 接口

| 方法 | 路径                                             | 认证           | 说明                             |
| ---- | ------------------------------------------------ | -------------- | -------------------------------- |
| POST | `/api/auth/login`                                | 无             | 校验账号密码并签发 JWT           |
| GET  | `/api/products`                                  | Bearer（必需） | 分页查询商品目录                 |
| POST | `/api/products`                                  | admin Bearer   | 新增商品                         |
| GET  | `/api/orders`                                    | Bearer（必需） | 分页查询当前用户订单             |
| POST | `/api/orders`                                    | Bearer（必需） | 创建多商品订单并原子扣减库存     |
| GET  | `/api/orders/{orderId}`                          | Bearer（必需） | 查询订单及商品明细               |
| POST | `/api/conversations/{conversationId}/complete`   | Bearer（必需） | 记录对话完成并发布 SNS 事件（幂等）|
| GET  | `/api/health`                                    | 无             | 健康检查                         |

> 契约提示：model-api 现期望扁平订单 JSON，本服务统一封装后订单在 `data` 内；`/complete` 端点契约为本项目自定 —— 均由 model-api 后续适配（见 specs/LESSONS.md）。

## 本地运行

```bash
cp .env.example .env   # 填入 Neon DATABASE_URL 与 AUTH_JWT_SECRET
cargo run              # 启动时自动应用 migration
```

Migration 负责表结构、商品演示数据和历史订单商品明细回填，不在源码中预置登录
账号。账号必须通过受控的数据库管理流程创建。

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
cargo check --features lambda --bin lambda  # 检查 Lambda 入口
cargo fmt --all                             # 格式化
cargo clippy --all-targets -- -D warnings   # Lint
cargo test                                  # 测试
cargo run --bin migrate                     # 只执行迁移，不启动 HTTP
```

项目位于外接磁盘，部分 macOS 外接盘文件系统不支持 Cargo 增量缓存使用的硬链接。
`Cargo.toml` 已为 `dev` 和 `test` 关闭增量编译，避免出现
`cached cgu ... should have an object file`。这只影响本地增量编译速度，不影响
Release/Lambda 产物。

## SNS 事件（可选 feature）

对话完成事件发布默认走 `NoopPublisher`（只记日志，本地无需 AWS）。启用真实 SNS：

```bash
cargo build --features sns   # 需 rustc ≥ 1.94.1（aws-sdk-sns 最新版 MSRV）
```

并设置 `SNS_TOPIC_ARN` 与 AWS 凭证（IAM Role/环境）。未启用 `sns` feature 时即便设了 ARN 也回退 no-op。

## 部署

生产打包为 API Gateway REST API + Lambda。`lambda_http` 同时兼容 API
Gateway REST API、HTTP API 和 Function URL 的 HTTP 事件，入口复用现有
Axum Router。

仓库的
[../../.github/workflows/backend-lambda.yml](../../.github/workflows/backend-lambda.yml)
使用 GitHub OIDC 获取短期 AWS 凭证，构建启用 `lambda,sns` 的 ZIP，并更新
已存在的 Lambda 函数。流水线只发布代码，不覆盖函数的运行时环境变量。

```bash
# 安装一次 cargo-lambda 后构建自定义运行时产物
cargo lambda build --release --bin lambda --features lambda

# 需要真实发布 SNS 事件时
cargo lambda build --release --bin lambda --features lambda,sns
```

Lambda 环境至少配置：

- `DATABASE_URL`：使用 Neon pooled connection 地址。
- `AUTH_JWT_SECRET`：通过 Lambda 环境变量或 Secrets Manager 注入。
- `AUTH_JWT_TTL_SECONDS`：可选，默认 86400。
- `CORS_ORIGINS`：允许直接调用订单接口的 Cloudflare 前端 Origin，逗号分隔。
- `DB_MAX_CONNECTIONS`：建议 1–2，避免多个冷启动放大数据库连接数。
- `SNS_TOPIC_ARN`：启用 `sns` feature 时配置，并给执行角色 `sns:Publish`。

## 知识检索

`POST /api/knowledge/search` 接收 1024 维向量、`topK` 和可选的
`productId/category/source` 过滤条件，返回统一响应封装中的相似知识片段。
底层使用 Neon pgvector cosine HNSW 索引，向量和过滤值均使用参数绑定。

Lambda 初始化阶段只执行一次依赖装配和数据库迁移，随后由同一执行环境复用
连接池与 Router。API Gateway 采用 Lambda proxy integration，并为所有路径
配置 `ANY /{proxy+}`（以及根路径 `ANY /`）。
