import { registerApiRoute } from "@mastra/core/server";

import { config } from "../../config";
import { chatRequestSchema } from "../../contracts/chat";
import { AppError, toAppError } from "../../lib/errors";
import { withTimeout } from "../../lib/signals";
import { backendClient } from "../../services/backend-client";
import { buildCustomerPrompt } from "../../services/prompt";
import { encodeSse, errorSseData, sseResponse } from "../../http/sse";

function getBearerToken(authorization: string | undefined): string {
  if (!authorization?.match(/^Bearer\s+\S+$/i)) {
    throw new AppError("UNAUTHORIZED", "请先登录", 401);
  }
  return authorization;
}

export const chatRoute = registerApiRoute("/api/chat/stream", {
  method: "POST",
  requiresAuth: false,
  handler: async (c) => {
    const traceId = c.req.header("x-trace-id")?.trim() || crypto.randomUUID();

    let requestBody: unknown;
    try {
      requestBody = await c.req.json();
    } catch {
      const error = new AppError(
        "INVALID_REQUEST",
        "请求内容必须是有效的 JSON",
        400,
      );
      return sseResponse(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encodeSse({
                event: "error",
                data: errorSseData(error, traceId),
              }),
            );
            controller.close();
          },
        }),
        error.status,
      );
    }

    const parsed = chatRequestSchema.safeParse(requestBody);
    if (!parsed.success) {
      const error = new AppError(
        "INVALID_REQUEST",
        "conversationId 和 message 均不能为空；orderId 如提供则必须有效",
        400,
      );
      return sseResponse(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encodeSse({
                event: "error",
                data: errorSseData(error, traceId),
              }),
            );
            controller.close();
          },
        }),
        error.status,
      );
    }

    let authorization: string;
    try {
      authorization = getBearerToken(c.req.header("authorization"));
    } catch (caught) {
      const error = toAppError(caught);
      return sseResponse(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encodeSse({
                event: "error",
                data: errorSseData(error, traceId),
              }),
            );
            controller.close();
          },
        }),
        error.status,
      );
    }

    const request = parsed.data;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encodeSse({ event: "start", data: { traceId } }));

        try {
          const order = request.orderId
            ? await backendClient.getOrder({
                orderId: request.orderId,
                authorization,
                traceId,
                signal: c.req.raw.signal,
              })
            : undefined;

          const agent = c.get("mastra").getAgent("customerOpsAgent");
          const result = await agent.stream(buildCustomerPrompt(request, order), {
            abortSignal: withTimeout(
              config.modelTimeoutMs,
              c.req.raw.signal,
            ),
          });

          for await (const text of result.textStream) {
            controller.enqueue(encodeSse({ event: "delta", data: { text } }));
          }

          controller.enqueue(
            encodeSse({
              event: "done",
              data: { conversationId: request.conversationId },
            }),
          );
        } catch (caught) {
          const sourceError = toAppError(caught);
          const error =
            sourceError.code === "INTERNAL_ERROR"
              ? new AppError(
                  "MODEL_UNAVAILABLE",
                  "模型服务暂时不可用，请稍后重试",
                  503,
                  true,
                  { cause: caught },
                )
              : sourceError;
          controller.enqueue(
            encodeSse({
              event: "error",
              data: errorSseData(error, traceId),
            }),
          );
        } finally {
          controller.close();
        }
      },
    });

    return sseResponse(stream);
  },
});
