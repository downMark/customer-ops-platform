export type MessageRole = "customer" | "agent";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  time: string; // display string, e.g. "14:22 PM"
  streaming?: boolean;
  error?: boolean;
}

export interface ChatStreamPayload {
  conversationId: string;
  orderId?: string;
  message: string;
}

export interface ChatStreamError {
  code: string;
  message: string;
  traceId?: string;
}

export interface ChatStreamHandlers {
  onStart?: (traceId: string) => void;
  onDelta?: (text: string) => void;
  onDone?: (conversationId: string) => void;
  onError?: (err: ChatStreamError) => void;
}
