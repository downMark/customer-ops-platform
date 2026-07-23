import { Mastra } from "@mastra/core/mastra";

import { config } from "../config";
import { customerOpsAgent } from "./agents/customer-ops-agent";
import { loginRoute } from "./routes/auth";
import { chatRoute } from "./routes/chat";
import { healthRoute } from "./routes/health";

export const mastra = new Mastra({
  agents: { customerOpsAgent },
  server: {
    apiPrefix: "/_mastra",
    apiRoutes: [healthRoute, loginRoute, chatRoute],
    cors: {
      origin: config.corsOrigins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type", "X-Trace-Id"],
      exposeHeaders: ["X-Trace-Id"],
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
