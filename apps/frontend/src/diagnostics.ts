// 可观测性自检入口的开关。
//
// 默认只在开发态开放：这个页面会往真实链路里灌人造错误，如果在生产可达，
// 任何人都能污染 Sentry 的 issue 和 DynamoDB 的聚合指标。
// 需要在预发环境验证链路时，用 VITE_ENABLE_DIAGNOSTICS=true 显式打开。
export const diagnosticsEnabled =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_DIAGNOSTICS === "true";
