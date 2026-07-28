import { Mastra } from "@mastra/core/mastra";

import { config } from "../config";
import { customerOpsAgent } from "./agents/customer-ops-agent";
import { loginRoute } from "./routes/auth";
import { chatRoute } from "./routes/chat";
import { healthRoute } from "./routes/health";
import { telemetryRoute } from "./routes/telemetry";

export const mastra = new Mastra({
  agents: { customerOpsAgent },
  server: {
    apiPrefix: "/_mastra",
    apiRoutes: [healthRoute, loginRoute, chatRoute, telemetryRoute],
    cors: {
      origin: config.corsOrigins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type", "X-Trace-Id", "Traceparent", "Tracestate"],
      exposeHeaders: ["X-Trace-Id", "Traceparent"],
    },
    build: {
      swaggerUI: true,
      apiReqLogs: {
        enabled: true,
        excludePaths: ["/api/health"],
      },
    },
  },
});
