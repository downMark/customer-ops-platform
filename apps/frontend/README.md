# customer-ops-frontend

智能客服系统前端 — **Service Console**。基于自定义 SSR 模板（React 19 + Koa + react-router 7 + TanStack Query + Tailwind），还原 `ui/` 下两张设计稿，并对接上游 model-api 的 SSE 流式聊天。

## 快速开始

```bash
pnpm install
pnpm mock        # 终端 A：json-server 提供 mock 数据 (:8007)
pnpm dev         # 终端 B：SSR 开发服务器 (:3001)
```

打开 http://localhost:3001 →

- `/chat`（默认）— Active Chats：三栏 Service Console，实时订单上下文 + AI 流式回复
- `/settings` — System Settings：服务端点、Ollama 推理引擎、客服规则、实时服务状态
- `/history` — Order History（占位）

## 命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | SSR 开发服务器（tsx + vite middleware，:3001） |
| `pnpm build` | 构建 client + server 产物到 `build/` |
| `pnpm preview:ssr` | 预览生产 SSR（:3001） |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | eslint |
| `pnpm mock` | json-server mock（:8007） |

## 目录

```
app/                 自定义 SSR 运行时（server / client / render / stream）
src/
  pages/             ActiveChat, SystemSettings, OrderHistory, index(布局)
  components/        Icon, Avatar, layout/(AppShell, SideNav, TopBar)
  apis/              services / model / queryKeys（axios 封装）
  index.css          Tailwind 基础层 + 组件类
config/              env / paths / constants
tailwind.config.js   设计 token（映射 ui/intelligent_service_core/DESIGN.md）
mocks/data.json      /chat-view、/settings-view mock
```

## 数据与流式

- 页面数据走 TanStack Query，SSR 预取（`src/routes/index.tsx` 的 `queryKey + loadData`），客户端水合；SSR 失败降级 CSR。
- 登录：`apis/services/Auth.ts` 通过 model-api `POST /api/auth/login` 取得真实 JWT。
- 聊天流式：`apis/services/Chat.ts` 携带登录 JWT 对接 model-api `POST /api/chat/stream`（SSE：`start → delta* → done | error`），支持「停止生成」（AbortController）。
- 本地无 model-api 时默认走**模拟流**（`VITE_USE_MOCK_STREAM=true`）；接入真实后端时设为 `false` 并配置 `VITE_CHAT_API_BASE_URL`。

## 环境变量

见 `.env.example`：`VITE_API_BASE_URL`（mock/数据）、`SSR_API_BASE_URL`、`VITE_CHAT_API_BASE_URL`（model-api）、`VITE_USE_MOCK_STREAM`。JWT 不再通过环境变量写死。

## 设计系统

token 源自 [ui/intelligent_service_core/DESIGN.md](../../ui/intelligent_service_core/DESIGN.md)（Enterprise Blue / Inter / 8px 圆角），落地在 `tailwind.config.js`。参照稿：`ui/active_service_chat/`、`ui/system_configuration/`。
