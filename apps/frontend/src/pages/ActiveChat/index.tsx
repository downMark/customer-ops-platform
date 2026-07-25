import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import ChatService from "apis/services/Chat";
import OrderService from "apis/services/Order";
import { extractOrderId } from "apis/orderId";
import { ChatMessage } from "apis/model/chat";
import Icon from "components/Icon";
import { AppOutletContext } from "components/layout/AppShell";
import OrderContextPanel from "./OrderContextPanel";

let messageSeq = 0;
const nextId = () => `m_${Date.now()}_${messageSeq++}`;

const formatNow = () => {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
};

const CustomerBubble = ({ message }: { message: ChatMessage }) => (
  <div className="ml-auto flex max-w-[92%] flex-row-reverse items-start gap-2 sm:max-w-2xl sm:gap-4">
    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface-container-high">
      <Icon name="person" className="text-sm" />
    </div>
    <div className="min-w-0 rounded-2xl rounded-tr-none bg-surface-container-low p-3 sm:p-4">
      <p className="text-body-md text-on-surface whitespace-pre-wrap">
        {message.text}
      </p>
      <span className="text-[10px] text-on-surface-variant mt-2 block">
        {message.time}
      </span>
    </div>
  </div>
);

const AgentBubble = ({ message }: { message: ChatMessage }) => (
  <div className="flex max-w-[92%] items-start gap-2 sm:max-w-2xl sm:gap-4">
    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-white">
      <Icon name="smart_toy" className="text-sm" filled />
    </div>
    <div
      className={`min-w-0 rounded-2xl rounded-tl-none p-3 shadow-md sm:p-4 ${
        message.error
          ? "bg-error-container text-on-error-container"
          : "bg-primary text-white"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">
          智能客服
        </span>
        {message.streaming && (
          <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full streaming-dots">
            正在生成
          </span>
        )}
      </div>
      <p className="text-body-md whitespace-pre-wrap">
        {message.text}
        {message.streaming && !message.text && "…"}
      </p>
    </div>
  </div>
);

const ActiveChat = () => {
  const { session } = useOutletContext<AppOutletContext>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeOrderId, setActiveOrderId] = useState("");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [mobileOrderOpen, setMobileOrderOpen] = useState(false);
  const conversationIdRef = useRef(
    `conv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
  );
  const abortRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: backendOrder, error: orderError } = useQuery({
    queryKey: ["order", activeOrderId],
    queryFn: () => OrderService.getOrder(activeOrderId),
    enabled: Boolean(session && activeOrderId),
    retry: false,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => () => abortRef.current?.(), []);

  const patchMessage = (id: string, patch: Partial<ChatMessage>) =>
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );

  const handleSend = () => {
    const text = input.trim();
    if (!text || streaming || !session) return;
    const mentionedOrderId = extractOrderId(text);
    const requestOrderId = mentionedOrderId || activeOrderId;
    if (mentionedOrderId) {
      setActiveOrderId(mentionedOrderId);
    }

    const customer: ChatMessage = {
      id: nextId(),
      role: "customer",
      text,
      time: formatNow(),
    };
    const agentId = nextId();
    const agent: ChatMessage = {
      id: agentId,
      role: "agent",
      text: "",
      time: formatNow(),
      streaming: true,
    };
    setMessages((prev) => [...prev, customer, agent]);
    setInput("");

    if (!requestOrderId) {
      patchMessage(agentId, {
        streaming: false,
        error: true,
        text: "请在消息中提供订单号，例如 ORD-2026-0001。",
      });
      return;
    }

    setStreaming(true);

    abortRef.current = ChatService.streamMessage(
      {
        conversationId: conversationIdRef.current,
        orderId: requestOrderId,
        message: text,
      },
      {
        onDelta: (chunk) =>
          setMessages((prev) =>
            prev.map((m) =>
              m.id === agentId ? { ...m, text: m.text + chunk } : m,
            ),
          ),
        onDone: () => {
          patchMessage(agentId, { streaming: false });
          setStreaming(false);
          abortRef.current = null;
        },
        onError: (err) => {
          patchMessage(agentId, {
            streaming: false,
            error: true,
            text: `⚠ ${err.message}${err.traceId ? `（追踪号 ${err.traceId}）` : ""}`,
          });
          setStreaming(false);
          abortRef.current = null;
        },
      },
    );
  };

  const handleStop = () => {
    abortRef.current?.();
    abortRef.current = null;
    setStreaming(false);
    setMessages((prev) =>
      prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
    );
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left: messaging */}
      <section className="flex-1 flex flex-col bg-white relative min-w-0">
        {/* Chat header */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-outline-variant p-3 sm:gap-4 sm:p-gutter">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary sm:h-10 sm:w-10">
              <Icon name="person" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold sm:text-body-lg">
                客户：{session.user.username}
              </h2>
              <p className="text-label-sm text-on-surface-variant flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500" /> 当前在线
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={!activeOrderId}
            onClick={() => setMobileOrderOpen(true)}
            className="flex max-w-[46%] items-center gap-1 rounded-full bg-secondary-container px-2 py-1 text-label-sm font-bold text-on-secondary-container disabled:opacity-60 sm:max-w-none sm:px-3 lg:cursor-default"
          >
            <Icon name="receipt_long" className="text-[16px]" />
            <span className="truncate">订单 #{activeOrderId || "—"}</span>
          </button>
          <span className="hidden text-sm text-on-surface-variant xl:block">
            {session.user.username}
          </span>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 space-y-4 overflow-y-auto p-3 sm:space-y-6 sm:p-gutter"
        >
          {messages.map((m) =>
            m.role === "customer" ? (
              <CustomerBubble key={m.id} message={m} />
            ) : (
              <AgentBubble key={m.id} message={m} />
            ),
          )}
        </div>

        {/* Input */}
        <div className="shrink-0 border-t border-outline-variant bg-white p-3 sm:p-gutter">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="输入消息，请包含需要查询的订单号…"
              className="min-w-0 flex-1 rounded-xl border border-outline-variant px-3 py-3 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/10 sm:px-4 sm:py-4"
            />
            <button
              type="button"
              className="hidden p-2 text-on-surface-variant transition-colors hover:text-primary sm:block"
              aria-label="添加附件"
            >
              <Icon name="attach_file" />
            </button>
            {streaming ? (
              <button
                type="button"
                onClick={handleStop}
                className="flex h-11 shrink-0 items-center gap-1 rounded-lg bg-error px-3 font-bold text-white shadow-sm transition-all hover:opacity-90 sm:px-4"
              >
                <span className="hidden sm:inline">停止</span>
                <Icon name="stop_circle" className="text-sm" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                className="flex h-11 shrink-0 items-center gap-1 rounded-lg bg-primary px-3 font-bold text-white shadow-sm transition-colors hover:bg-primary-container sm:px-4"
                aria-label="发送消息"
              >
                <span className="hidden sm:inline">发送</span>
                <Icon name="send" className="text-sm" />
              </button>
            )}
          </div>
        </div>

        {mobileOrderOpen && activeOrderId && (
          <div className="absolute inset-0 z-30 flex flex-col bg-white lg:hidden">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-outline-variant px-4">
              <div>
                <p className="text-xs font-bold text-primary">订单详情</p>
                <p className="max-w-[250px] truncate text-sm font-semibold">
                  {activeOrderId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMobileOrderOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-container"
                aria-label="关闭订单详情"
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {backendOrder ? (
                <OrderContextPanel order={backendOrder} mobile />
              ) : (
                <div className="p-5 text-sm text-on-surface-variant">
                  {orderError
                    ? (orderError as Error).message
                    : `正在加载订单 ${activeOrderId}…`}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Right: order context */}
      {session && activeOrderId && (
        <div className="hidden lg:flex">
          {backendOrder ? (
            <OrderContextPanel order={backendOrder} />
          ) : (
            <aside className="w-80 lg:w-96 border-l border-outline-variant bg-surface-container-lowest p-6 text-sm text-on-surface-variant">
              {orderError
                ? (orderError as Error).message
                : `正在加载订单 ${activeOrderId}…`}
            </aside>
          )}
        </div>
      )}
    </div>
  );
};

export default ActiveChat;
