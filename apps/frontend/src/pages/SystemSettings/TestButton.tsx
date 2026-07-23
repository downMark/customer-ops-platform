import { useRef, useState } from "react";
import Icon from "components/Icon";

type Phase = "idle" | "testing" | "ok";

/** Mimics the mockup's Test Connection / Test Model button state machine. */
const TestButton = ({ label }: { label: string }) => {
  const [phase, setPhase] = useState<Phase>("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const run = () => {
    if (phase !== "idle") return;
    setPhase("testing");
    timers.current.push(
      setTimeout(() => setPhase("ok"), 1500),
      setTimeout(() => setPhase("idle"), 3500)
    );
  };

  const base =
    "px-4 py-2 font-label-sm rounded-lg transition-all flex items-center gap-2 whitespace-nowrap";

  if (phase === "testing") {
    return (
      <button type="button" disabled className={`${base} bg-secondary-container text-on-secondary-container opacity-75`}>
        <Icon name="sync" className="text-sm animate-spin" /> 测试中…
      </button>
    );
  }
  if (phase === "ok") {
    return (
      <button type="button" disabled className={`${base} bg-emerald-100 text-emerald-700`}>
        <Icon name="check_circle" className="text-sm" /> 连接成功
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={run}
      className={`${base} bg-secondary-container text-on-secondary-container hover:bg-secondary hover:text-on-secondary`}
    >
      {label}
    </button>
  );
};

export default TestButton;
