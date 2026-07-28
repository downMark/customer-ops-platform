import AuthService from "./Auth";
import { getModelApiBaseURL } from "../runtime";
import {
  ChatStreamHandlers,
  ChatStreamPayload,
} from "../model/chat";
import { browserPerformance } from "../../performance";

class ChatService {
  /**
   * Stream an agent reply. Talks to model-api `POST /api/chat/stream` (SSE:
   * start → delta* → done | error). Falls back to a simulated local stream in
   * Returns a function that aborts the in-flight stream.
   */
  static streamMessage(
    payload: ChatStreamPayload,
    handlers: ChatStreamHandlers
  ): () => void {
    const controller = new AbortController();

    runSseStream(payload, handlers, controller.signal);

    return () => controller.abort();
  }
}

async function runSseStream(
  payload: ChatStreamPayload,
  handlers: ChatStreamHandlers,
  signal: AbortSignal
) {
  const span = browserPerformance.startSpan("chat.sse", {
    attributes: { endpoint: "/api/chat/stream", httpMethod: "POST" },
  });
  const startedAt = performance.now();
  let firstDelta = false;
  let ttftMs: number | undefined;
  try {
    const token = AuthService.getAccessToken();
    if (!token) {
      handlers.onError?.({
        code: "UNAUTHORIZED",
        message: "登录状态已失效，请重新登录。",
      });
      return;
    }

    const res = await fetch(`${getModelApiBaseURL()}/api/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${token}`,
        Traceparent: `00-${span.context.traceId}-${span.context.spanId}-${span.context.sampled ? "01" : "00"}`,
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!res.ok || !res.body) {
      if (res.status === 401) AuthService.clearSession();
      handlers.onError?.({
        code: res.status === 401 ? "UNAUTHORIZED" : "ORDER_SERVICE_UNAVAILABLE",
        message:
          res.status === 401
            ? "登录状态已失效，请重新登录。"
            : `聊天服务暂时不可用 (${res.status})`,
      });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        if (!firstDelta && frame.includes("event: delta")) {
          firstDelta = true;
          ttftMs = performance.now() - startedAt;
        }
        dispatchSseFrame(frame, handlers);
      }
    }
    span.finish("ok", ttftMs === undefined ? {} : { ttftMs });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      span.finish("cancelled");
      return;
    }
    span.finish("error");
    browserPerformance.captureError("chat.sse", err, span.context);
    handlers.onError?.({
      code: "STREAM_FAILED",
      message: "无法连接聊天服务，请稍后重试。",
    });
  }
}

function dispatchSseFrame(frame: string, handlers: ChatStreamHandlers) {
  let event = "message";
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return;

  try {
    const parsed = JSON.parse(data);
    if (event === "start") handlers.onStart?.(parsed.traceId);
    else if (event === "delta") handlers.onDelta?.(parsed.text ?? "");
    else if (event === "done") handlers.onDone?.(parsed.conversationId);
    else if (event === "error") handlers.onError?.(parsed);
  } catch {
    /* ignore malformed frame */
  }
}

export default ChatService;
