import { registerApiRoute } from "@mastra/core/server";

import { config } from "../../config";
import { chatRequestSchema } from "../../contracts/chat";
import { AppError, toAppError } from "../../lib/errors";
import { withTimeout } from "../../lib/signals";
import { backendClient } from "../../services/backend-client";
import { retrieveKnowledge } from "../../services/knowledge";
import { buildCustomerPrompt } from "../../services/prompt";
import {
  encodeSse,
  encodeSseComment,
  errorSseData,
  sseResponse,
} from "../../http/sse";
import {
  performanceClient,
  requestTraceContext,
  withPerformanceTrace,
} from "../../performance";
import { formatTraceparent } from "../../performance-sdk";

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
    const requestSpan = performanceClient.startSpan("chat.stream", {
      parent: requestTraceContext(c.req.header("traceparent")),
      attributes: { endpoint: "/api/chat/stream", httpMethod: "POST" },
    });
    const downstreamTraceparent = formatTraceparent(requestSpan.context);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const startedAt = performance.now();
        let firstDelta = false;
        let ttftMs: number | undefined;
        controller.enqueue(encodeSse({ event: "start", data: { traceId } }));
        // BGE and a CPU-only LLM can have a long time-to-first-token. Keep the
        // public ALB/Cloudflare/browser stream active while no model delta exists.
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encodeSseComment());
          } catch {
            clearInterval(heartbeat);
          }
        }, 15_000);

        try {
          const [order, references] = await Promise.all([
            request.orderId
              ? backendClient.getOrder({
                  orderId: request.orderId,
                  authorization,
                  traceId,
                  traceparent: downstreamTraceparent,
                  signal: c.req.raw.signal,
                })
              : Promise.resolve(undefined),
            retrieveKnowledge({
              query: request.message,
              authorization,
              traceId,
              traceparent: downstreamTraceparent,
              signal: c.req.raw.signal,
            }),
          ]);

          const agent = c.get("mastra").getAgent("customerOpsAgent");
          const result = await withPerformanceTrace(
            requestSpan.context,
            () => agent.stream(
              buildCustomerPrompt(request, order, references),
              {
                abortSignal: withTimeout(
                  config.modelTimeoutMs,
                  c.req.raw.signal,
                ),
              },
            ),
          );

          for await (const text of result.textStream) {
            if (!firstDelta) {
              firstDelta = true;
              ttftMs = performance.now() - startedAt;
            }
            controller.enqueue(encodeSse({ event: "delta", data: { text } }));
          }

          controller.enqueue(
            encodeSse({
              event: "done",
              data: { conversationId: request.conversationId },
            }),
          );
          requestSpan.finish("ok", ttftMs === undefined ? {} : { ttftMs });
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
          const cancelled =
            caught instanceof Error && caught.name === "AbortError";
          requestSpan.finish(cancelled ? "cancelled" : "error");
          if (!cancelled) {
            performanceClient.captureError(
              "chat.stream",
              caught,
              requestSpan.context,
              error.code,
            );
          }
        } finally {
          clearInterval(heartbeat);
          controller.close();
        }
      },
    });

    return sseResponse(stream);
  },
});
