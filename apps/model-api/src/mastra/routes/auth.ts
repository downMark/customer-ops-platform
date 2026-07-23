import { registerApiRoute } from "@mastra/core/server";

import { loginRequestSchema } from "../../contracts/auth";
import { toAppError } from "../../lib/errors";
import { backendClient } from "../../services/backend-client";

export const loginRoute = registerApiRoute("/api/auth/login", {
  method: "POST",
  requiresAuth: false,
  handler: async (c) => {
    const payload: unknown = await c.req.json().catch(() => null);
    const parsed = loginRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return c.json(
        {
          code: 40001,
          success: false,
          msg: "请求参数错误",
          data: null,
        },
        400,
      );
    }

    try {
      const result = await backendClient.login(
        parsed.data,
        c.req.raw.signal,
      );
      return c.json({
        code: 200,
        success: true,
        msg: "ok",
        data: result,
      });
    } catch (caught) {
      const error = toAppError(caught);
      const status = error.status === 401 ? 401 : 503;
      return c.json(
        {
          code: status === 401 ? 40101 : 50301,
          success: false,
          msg: error.message,
          data: null,
        },
        status,
      );
    }
  },
});
