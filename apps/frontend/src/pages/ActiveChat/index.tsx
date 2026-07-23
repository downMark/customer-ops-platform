import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PrefetchKeys } from "apis/queryKeys";
import ChatService from "apis/services/Chat";
import AuthService from "apis/services/Auth";
import { AuthSession } from "apis/model/auth";
import { extractOrderId } from "apis/orderId";
import { ChatMessage } from "apis/model/chat";
import Icon from "components/Icon";
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
  <div className="flex items-start gap-4 max-w-2xl ml-auto flex-row-reverse">
    <div className="w-8 h-8 rounded-full bg-surface-container-high flex-shrink-0 flex items-center justify-center">
      <Icon name="person" className="text-sm" />
    </div>
    <div className="bg-surface-container-low p-4 rounded-2xl rounded-tr-none">
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
  <div className="flex items-start gap-4 max-w-2xl">
    <div className="w-8 h-8 rounded-full bg-primary flex-shrink-0 flex items-center justify-center text-white">
      <Icon name="smart_toy" className="text-sm" filled />
    </div>
    <div
      className={`p-4 rounded-2xl rounded-tl-none shadow-md ${
        message.error
          ? "bg-error-container text-on-error-container"
          : "bg-primary text-white"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">
          AI 客服（Mastra 运营）
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
  const { data: view } = useQuery({
    queryKey: [PrefetchKeys.CHAT_VIEW],
    queryFn: () => ChatService.getChatView(),
  });

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeOrderId, setActiveOrderId] = useState("");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const seededRef = useRef(false);
  const abortRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSession(AuthService.getSession());
  }, []);

  // Seed local message list from the prefetched view exactly once.
  useEffect(() => {
    if (view && !seededRef.current) {
      setMessages(view.messages);
      setActiveOrderId(view.orderId);
      seededRef.current = true;
    }
  }, [view]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const patchMessage = (id: string, patch: Partial<ChatMessage>) =>
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m))
    );

  const handleSend = () => {
    const text = input.trim();
    if (!text || streaming || !view) return;
    const mentionedOrderId = extractOrderId(text);
    const requestOrderId = mentionedOrderId || activeOrderId || view.orderId;
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
    setStreaming(true);

    abortRef.current = ChatService.streamMessage(
      {
        conversationId: view.conversationId,
        orderId: requestOrderId,
        message: text,
      },
      {
        onDelta: (chunk) =>
          setMessages((prev) =>
            prev.map((m) =>
              m.id === agentId ? { ...m, text: m.text + chunk } : m
            )
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
            text: `⚠ ${err.message}${err.traceId ? `（trace ${err.traceId}）` : ""}`,
          });
          setStreaming(false);
          abortRef.current = null;
        },
      }
    );
  };

  const handleStop = () => {
    abortRef.current?.();
    abortRef.current = null;
    setStreaming(false);
    setMessages((prev) =>
      prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
    );
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loggingIn) return;
    setLoggingIn(true);
    setLoginError("");
    try {
      setSession(await AuthService.login(username.trim(), password));
      setPassword("");
    } catch (error) {
      setLoginError((error as Error).message);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = () => {
    abortRef.current?.();
    AuthService.clearSession();
    setSession(null);
  };

  if (!session) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-container-low p-6">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-md rounded-2xl bg-white border border-outline-variant p-8 shadow-lg"
        >
          <div className="w-12 h-12 rounded-xl bg-primary text-white flex items-center justify-center mb-5">
            <Icon name="support_agent" filled />
          </div>
          <h1 className="text-2xl font-bold text-on-surface">登录客服控制台</h1>
          <p className="text-sm text-on-surface-variant mt-2 mb-6">
            登录后，Mastra 会使用您的身份向订单服务查询数据。
          </p>
          <label className="block text-sm font-medium text-on-surface mb-2">
            用户名
          </label>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            className="w-full border border-outline-variant rounded-xl px-4 py-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
          <label className="block text-sm font-medium text-on-surface mt-4 mb-2">
            密码
          </label>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            className="w-full border border-outline-variant rounded-xl px-4 py-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
          {loginError && (
            <p className="mt-3 text-sm text-error" role="alert">
              {loginError}
            </p>
          )}
          <button
            type="submit"
            disabled={loggingIn || !username.trim() || !password}
            className="mt-6 w-full rounded-xl bg-primary text-white py-3 font-bold disabled:opacity-50"
          >
            {loggingIn ? "正在登录…" : "登录"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left: messaging */}
      <section className="flex-1 flex flex-col bg-white relative min-w-0">
        {/* Chat header */}
        <div className="p-gutter border-b border-outline-variant flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center text-on-primary">
              <Icon name="person" />
            </div>
            <div>
              <h2 className="font-bold text-body-lg">
                客户：{view?.customer.name ?? "—"}
              </h2>
              <p className="text-label-sm text-on-surface-variant flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500" /> 自
                {view?.customer.activeSince ?? "—"} 起在线
              </p>
            </div>
          </div>
          <span className="px-3 py-1 bg-secondary-container text-on-secondary-container rounded-full text-label-sm font-bold flex items-center gap-1">
            <Icon name="receipt_long" className="text-[16px]" />
            订单 #{activeOrderId || view?.orderId || "—"}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm text-on-surface-variant hover:text-primary"
          >
            退出 {session.user.username}
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-gutter space-y-6">
          {messages.map((m) =>
            m.role === "customer" ? (
              <CustomerBubble key={m.id} message={m} />
            ) : (
              <AgentBubble key={m.id} message={m} />
            )
          )}
        </div>

        {/* Input */}
        <div className="p-gutter border-t border-outline-variant bg-white shrink-0">
          <div className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="输入消息，或使用 /cmd 执行客服操作…"
              className="w-full border border-outline-variant rounded-xl py-4 pl-4 pr-40 focus:ring-2 focus:ring-primary/10 focus:border-primary transition-all outline-none"
            />
            <div className="absolute right-3 flex items-center gap-2">
              <button
                type="button"
                className="p-2 text-on-surface-variant hover:text-primary transition-colors"
                aria-label="添加附件"
              >
                <Icon name="attach_file" />
              </button>
              {streaming ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="bg-error text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:opacity-90 transition-all shadow-sm"
                >
                  <span>停止</span>
                  <Icon name="stop_circle" className="text-sm" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSend}
                  className="bg-primary text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-primary-container transition-colors shadow-sm"
                >
                  <span>发送</span>
                  <Icon name="send" className="text-sm" />
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Right: order context (hidden on small screens) */}
      {view && (activeOrderId || view.orderId) === view.orderId && (
        <div className="hidden pad:flex pc:flex">
          <OrderContextPanel order={view.order} />
        </div>
      )}
    </div>
  );
};

export default ActiveChat;
