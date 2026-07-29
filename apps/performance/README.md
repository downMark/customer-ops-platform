# Customer Ops Performance

独立性能观测项目，包含统一事件协议、TypeScript/Rust/Python SDK、AWS 日志
清洗器、本地性能看板和本地 Sentry 同步工具。

所有事件都遵循 `schema/performance-event-v1.schema.json`。协议只有固定白名单，
不得记录用户输入、模型输出、身份、订单、请求体、响应体、Cookie、凭证或 URL
查询参数。

## 数据流

```text
SDK -> CloudWatch Logs -> Kinesis -> ECS cleaner
    -> DynamoDB minute aggregates ─┐
    -> S3 sanitized details ───────┼─> local console (指标 / trace / AIOps)
                                   └─> sync.mjs -> local Sentry (issue 聚合 / 告警)
                                                      └─> console 读回 issue 面板
```

Console 与 Sentry 仅绑定 `127.0.0.1`，不加入任何云端发布工作流。

界面统一在 Console，不改 Sentry 前端。**性能指标与 trace 由 Console 直读
DynamoDB / S3**，不绕经 Sentry；Sentry 只负责它独有的能力（issue 聚合、等级、
影响面），Console 通过只读 Auth Token 调 `/api/0/projects/{org}/{project}/issues/`
读回来渲染成「错误聚合与告警」面板。未配置或 Sentry 未启动时该面板显示
「未接入」，其余面板不受影响。

## 本地运行

一键启动本地 Console、Kimi AIOps Agent 和 Sentry。首次运行会自动安装固定版本
的 Sentry self-hosted，因此需要 Docker Compose 2.32.2 或更高版本，并先启动
Docker Desktop。首次安装耗时会较长；默认不向 Sentry 上报 self-hosted 安装
问题。Sentry 还要求 Docker 至少分配 14000 MiB 内存；在 Docker Desktop 的
Settings → Resources → Advanced 中将 Memory 设置为至少 14 GB 并重启。
macOS 自带 Bash 3.2 不满足要求，首次运行前执行 `brew install bash`；启动器
会自动选择 Homebrew Bash 4.4+。如果本机无法提供所需内存，可使用
`./start.sh --console-only`：

```bash
cd apps/performance
./start.sh
```

只启动 Console，或停止全部本地服务：

```bash
./start.sh --console-only
./stop.sh
```

AWS Cleaner 是 ECS 常驻服务，一键脚本不会在本地重复启动它。

也可以使用下面的开发模式手动启动：

```bash
cd apps/performance
pnpm install:js
pnpm build:js

cp console/.env.example console/.env
pnpm console
```

Console 默认地址为 `http://127.0.0.1:4318`。没有配置 AWS 聚合表时自动使用
脱敏演示数据；生产读取账号应套用 `console/readonly-iam-policy.json` 的只读权限。
`pnpm console` 会自动读取 `console/.env`；只想查看本地演示数据时，将其中的
`PERFORMANCE_DEMO` 设为 `true`。Kimi K3 API Key 也只写在这个本地文件中。
表名和桶名以 foundation CloudFormation 的
`PerformanceAggregateTableName`、`PerformanceDetailBucketName` 输出为准。

## Kimi K3 AIOps Agent

Agent 位于 `agent/`，只读取 Console 已加载的脱敏聚合数据。设置
`MOONSHOT_API_KEY` 后通过 Moonshot OpenAI-compatible Chat Completions API
调用 `kimi-k3`；没有 API Key 或调用失败时回退到确定性 GPU/排队/TTFT/错误率
规则。Agent 没有 AWS 写权限，也没有重启、扩缩容或改配置工具。
即使调用方误传额外字段，Agent 也会再次投影到固定聚合白名单后再发送给 Kimi。

## 本地 Sentry

```bash
cd apps/performance/sentry
./install.sh
./start.sh
./health.sh
```

安装器固定 Sentry self-hosted 26.5.1 并绑定 `127.0.0.1:9000`。在 Sentry
创建本地项目后，将其 OTLP traces URL 写入环境变量，再运行 `pnpm sync` 从
S3 增量同步脱敏 trace。同步 checkpoint 只保存在 `sentry/.runtime/`。
如果仓库位于 exFAT 等外接 macOS 磁盘，安装器会在构建前自动清理由扩展属性
生成的 `._*` AppleDouble 文件，避免 Docker BuildKit 的 `failed to xattr`
错误。Sentry 的公开镜像默认通过项目内无凭证 Docker 配置拉取，避免新版
Docker Desktop 凭证助手卡住；需要私有镜像凭证时可设置
`SENTRY_DOCKER_CONFIG` 指向其他 Docker 配置目录。为避免 Docker Compose 5
并发拉取多个 registry 时挂起，安装器会逐个检查并拉取固定版本镜像，再跳过
Sentry 上游中冗余的聚合拉取步骤；失败镜像最多重试三次。

### 把 issue 接进 Console

Sentry 起来后，在 Settings → Account → API → Auth Tokens 创建一个只带
`project:read` 的 token，填进 `console/.env`：

```bash
SENTRY_BASE_URL=http://127.0.0.1:9000
SENTRY_AUTH_TOKEN=<只读 token>
SENTRY_ORG=<组织 slug>
SENTRY_PROJECT=<项目 slug>
```

重启 Console 后「错误聚合与告警」面板生效。Token 只保存在本地 `console/.env`，
仅在服务端使用，不会下发到浏览器；Sentry 返回的 `permalink` 按不可信输入处理，
只放行 `http(s)`。四个变量任缺其一即视为未接入，面板安静降级，不影响指标与
trace 面板。

CloudFormation 创建 Kinesis、DynamoDB、S3、ECR、最小权限角色和单副本
Fargate cleaner。Infrastructure 工作流先更新 foundation、构建 cleaner 镜像，
再更新 runtime。Console、Sentry 与 AIOps Agent 不会被部署到云端。

## 验证

```bash
pnpm test:js
cd sdk/rust && cargo test
cd ../python && PYTHONPATH=src python -m pytest
```

SDK 测试包含 traceparent、10%/强制采样、敏感字段过滤、队列降级和单次
`startSpan`/`finish` 的 p95 小于 1ms。Cleaner 测试覆盖非法记录、去重、
checkpoint 恢复、分钟直方图、release 隔离以及仅将 trace/error 写入 S3。
