import request from "apis";
import AuthService from "./Auth";
import { getModelApiBaseURL } from "../runtime";
import {
  ChatStreamHandlers,
  ChatStreamPayload,
  ChatView,
} from "../model/chat";

/**
 * Base URL of the model-api (Mastra) chat service. In dev this points at the
 * local model-api; the mock stream below runs when it is unreachable / disabled.
 */
const useMockStream = () =>
  typeof import.meta === "undefined" ||
  import.meta.env?.VITE_USE_MOCK_STREAM !== "false";

class ChatService {
  /** Aggregate view for the Active Chats page (customer + order + messages). */
  static getChatView(): Promise<ChatView> {
    return request.get("/chat-view");
  }

  /**
   * Stream an agent reply. Talks to model-api `POST /api/chat/stream` (SSE:
   * start → delta* → done | error). Falls back to a simulated local stream in
   * dev so the UI is demonstrable without a running backend.
   * Returns a function that aborts the in-flight stream.
   */
  static streamMessage(
    payload: ChatStreamPayload,
    handlers: ChatStreamHandlers
  ): () => void {
    const controller = new AbortController();

    if (useMockStream()) {
      runMockStream(payload, handlers, controller.signal);
    } else {
      runSseStream(payload, handlers, controller.signal);
    }

    return () => controller.abort();
  }
}

async function runSseStream(
  payload: ChatStreamPayload,
  handlers: ChatStreamHandlers,
  signal: AbortSignal
) {
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
      for (const frame of frames) dispatchSseFrame(frame, handlers);
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
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

/** Simulated token stream for local development without model-api. */
async function runMockStream(
  payload: ChatStreamPayload,
  handlers: ChatStreamHandlers,
  signal: AbortSignal
) {
  const reply =
    `正在为 ${payload.orderId} 检索国际物流日志。已定位到您的包裹位于北京枢纽 (ZBAA)，` +
    `目前正在进行常规出口清关。根据最新的遥测数据，预计将在 24 小时内完成清关并继续发往目的地。`;
  const tokens = reply.match(/[一-龥]|\S+\s*/g) ?? [reply];

  handlers.onStart?.(`trace_mock_${payload.conversationId}`);

  for (const token of tokens) {
    if (signal.aborted) return;
    await delay(45);
    if (signal.aborted) return;
    handlers.onDelta?.(token);
  }
  handlers.onDone?.(payload.conversationId);
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export default ChatService;
