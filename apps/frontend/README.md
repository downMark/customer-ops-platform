# customer-ops-frontend

智能客服系统前端 — **Service Console**。基于自定义 SSR 模板（React 19 + Koa + react-router 7 + TanStack Query + Tailwind），支持本地 Node.js 和 Cloudflare Workers 两种 SSR 运行时，并对接上游 model-api 的 SSE 流式聊天。

## 快速开始

```bash
pnpm install
pnpm dev
```

打开 http://localhost:3002。左侧菜单提供：

- `/chat`：Mastra 客服对话及当前订单上下文。
- `/orders`：分页查询订单、商品摘要和订单金额。
- `/addOrder`：选择一个或多个有效商品创建订单。
- `/products`：分页查看商品目录；管理员可以进入 `/products/new` 新增商品。

登录是整个应用的前置门禁：未登录时不渲染侧边栏、聊天或订单页面；登录成功后
两个页面共享同一 JWT 会话。

## 命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | SSR 开发服务器（tsx + vite middleware，:3002） |
| `pnpm build` | 构建 client + server 产物到 `build/` |
| `pnpm build:worker` | 构建 client + Cloudflare Worker SSR 产物 |
| `pnpm preview:ssr` | 预览生产 SSR（:3002） |
| `pnpm dev:worker` | 构建并用本地 Workers Runtime 启动 SSR |
| `pnpm check:worker` | 构建并执行 Wrangler dry-run |
| `pnpm deploy:worker:staging` | 发布 staging Worker |
| `pnpm deploy:worker:production` | 发布 production Worker |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | eslint |

## 目录

```
app/                 自定义 SSR 运行时（server / client / render / stream）
  server/worker.ts   Cloudflare Node HTTP → Koa 适配入口
src/
  pages/             客服聊天、订单、添加订单和商品管理
  components/        Icon、AppShell 与双入口 SideNav
  apis/              services / model / queryKeys（axios 封装）
  index.css          Tailwind 基础层 + 组件类
config/              env / paths / constants
tailwind.config.js   设计 token（映射 ui/intelligent_service_core/DESIGN.md）
wrangler.jsonc       Workers、静态资源及 staging/production 配置
```

## 数据与流式

- 页面数据走 TanStack Query，SSR 预取（`src/routes/index.tsx` 的 `queryKey + loadData`），客户端水合；SSR 失败降级 CSR。
- 登录：`apis/services/Auth.ts` 通过 model-api `POST /api/auth/login` 取得真实 JWT。
- 聊天流式：`apis/services/Chat.ts` 携带登录 JWT 对接 model-api `POST /api/chat/stream`（SSE：`start → delta* → done | error`），支持「停止生成」（AbortController）。
- 订单侧栏：`apis/services/Order.ts` 携带同一 JWT 直接请求 Backend
  `GET /api/orders/{orderId}`，不使用 Mastra 的生成结果充当订单事实。
- model-api 不可用时明确显示连接错误，不使用模拟回复掩盖故障。

## 环境变量

见 `.env.example`：`VITE_API_BASE_URL`（Backend Lambda API）、
`SSR_API_BASE_URL`、`VITE_CHAT_API_BASE_URL`（model-api）、
JWT 不再通过环境变量写死。

`VITE_*` 在构建 client 时写入浏览器 bundle；`SSR_API_BASE_URL` 是 Worker
运行时变量。GitHub Actions 发布时从对应的 GitHub Environment 读取这些值，
并使用命令行参数覆盖 `wrangler.jsonc` 中只供本地/dry-run 使用的示例地址。

## Cloudflare Workers SSR

Workers 使用 `nodejs_compat` 和 Cloudflare `httpServerHandler` 复用现有 Koa
`app.callback()`。客户端静态资源输出到 `build/client/static`，由 Workers
Assets 直接提供；页面路由没有对应静态文件时进入 Worker 执行 React SSR。

```bash
pnpm install
pnpm types:worker
pnpm check:worker
pnpm deploy:worker:staging
```

自动发布见
[../../.github/workflows/frontend-cloudflare.yml](../../.github/workflows/frontend-cloudflare.yml)。
不要把 token、账号密码或 API secret 写入 `vars`；机密值使用 GitHub
Environment secrets、`wrangler secret put` 或 Cloudflare Dashboard。
