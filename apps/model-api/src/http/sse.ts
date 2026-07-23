import type { PublicErrorCode } from "../lib/errors";
import type { AppError } from "../lib/errors";

const encoder = new TextEncoder();

export type SseEvent =
  | { event: "start"; data: { traceId: string } }
  | { event: "delta"; data: { text: string } }
  | { event: "done"; data: { conversationId: string } }
  | {
      event: "error";
      data: {
        code: PublicErrorCode;
        message: string;
        traceId: string;
        retryable: boolean;
      };
    };

export function encodeSse(event: SseEvent): Uint8Array {
  return encoder.encode(
    `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`,
  );
}

export function errorSseData(error: AppError, traceId: string) {
  return {
    code: error.code,
    message: error.message,
    traceId,
    retryable: error.retryable,
  };
}

export function sseResponse(
  stream: ReadableStream<Uint8Array>,
  status = 200,
): Response {
  return new Response(stream, {
    status,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
