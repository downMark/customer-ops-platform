import { registerApiRoute } from "@mastra/core/server";

import { config } from "../../config";
import { backendClient } from "../../services/backend-client";
import { getModelServerHealth } from "../../services/model-server-health";

export const healthRoute = registerApiRoute("/api/health", {
  method: "GET",
  requiresAuth: false,
  handler: async (c) => {
    const [backendHealthy, modelServerHealthy] = await Promise.all([
      backendClient.isHealthy(c.req.raw.signal),
      getModelServerHealth(c.req.raw.signal),
    ]);
    const healthy = backendHealthy && modelServerHealthy;

    return c.json(
      {
        status: healthy ? "ok" : "degraded",
        dependencies: {
          backend: backendHealthy ? "ok" : "unavailable",
          modelServer: modelServerHealthy ? "ok" : "unavailable",
          model: config.modelServerModel,
        },
      },
      healthy ? 200 : 503,
    );
  },
});
