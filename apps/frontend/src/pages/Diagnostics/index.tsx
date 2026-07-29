import { useEffect, useState } from "react";
import AuthService from "apis/services/Auth";
import Icon from "components/Icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  browserPerformance,
  performanceFetch,
  reportVitals,
} from "../../performance";

interface Probe {
  id: string;
  label: string;
  icon: string;
  /** 触发后预期进入链路的事件，用于和下游对照。 */
  expects: string;
  description: string;
  run: () => void | Promise<void>;
}

interface LogEntry {
  at: string;
  label: string;
  expects: string;
}

const probes: Probe[] = [
  {
    id: "uncaught",
    label: "未捕获异常",
    icon: "error",
    expects: "browser.uncaught · TypeError",
    description: "等价于代码里 throw 出来没人接，控制台会同时打印一条红色报错。",
    run: () => {
      // 放进 setTimeout 才会成为未捕获异常；同步 throw 会被 onClick 接住。
      setTimeout(() => {
        throw new TypeError("diagnostics: uncaught error");
      }, 0);
    },
  },
  {
    id: "rejection",
    label: "未处理的 Promise 拒绝",
    icon: "warning",
    expects: "browser.unhandled_rejection · UnhandledRejection",
    description: "用非 Error 值拒绝，验证兜底分支能给出稳定的错误类型名。",
    run: () => {
      void Promise.reject("diagnostics: rejected with a string");
    },
  },
  {
    id: "resource",
    label: "资源加载失败",
    icon: "broken_image",
    expects: "browser.resource · ResourceLoadError",
    description: "插入一个必然 404 的图片。这类错误不冒泡，只有捕获阶段收得到。",
    run: () => {
      const image = document.createElement("img");
      image.src = `/diagnostics-missing-${Date.now()}.png`;
      image.style.display = "none";
      document.body.appendChild(image);
      image.addEventListener("error", () => image.remove());
    },
  },
  {
    id: "api",
    label: "接口网络失败",
    icon: "cloud_off",
    expects: "api.request · TypeError（span 同时记为 error）",
    description:
      "请求一个必然连不上的地址。注意 4xx/5xx 只会记 span，不算错误事件。",
    run: async () => {
      try {
        await performanceFetch("http://127.0.0.1:1/diagnostics-probe");
      } catch {
        // 预期内的失败，探针要的就是它。
      }
    },
  },
  {
    id: "vitals",
    label: "上报 Web Vitals",
    icon: "speed",
    expects: "web_vital.page · metric",
    description:
      "强制上报一次页面终值（LCP / CLS / INP / TTFB）。正常链路只在页面隐藏时报一次。",
    run: () => reportVitals(true),
  },
];

const Diagnostics = () => {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [hasToken, setHasToken] = useState(false);
  const [flushing, setFlushing] = useState(false);

  useEffect(() => {
    setHasToken(Boolean(AuthService.getAccessToken()));
  }, []);

  const trigger = async (probe: Probe) => {
    await probe.run();
    setLog((entries) => [
      { at: new Date().toLocaleTimeString("zh-CN"), label: probe.label, expects: probe.expects },
      ...entries,
    ].slice(0, 30));
  };

  const flush = async () => {
    setFlushing(true);
    try {
      await browserPerformance.flush();
      setLog((entries) => [
        { at: new Date().toLocaleTimeString("zh-CN"), label: "手动刷新队列", expects: "POST /api/telemetry/v1/batch" },
        ...entries,
      ].slice(0, 30));
    } finally {
      setFlushing(false);
    }
  };

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Icon name="biotech" className="text-primary text-2xl" filled />
          <h1 className="text-2xl font-bold text-on-surface">可观测性自检</h1>
          <Badge variant="outline">仅非生产环境</Badge>
        </div>
        <p className="text-sm text-on-surface-variant">
          手动往真实链路里灌事件，验证「前端捕获 → model-api 遥测端点 → CloudWatch → Kinesis
          → cleaner → S3 → Sentry」是否打通，不必等线上真的出错。
        </p>
      </header>

      {!hasToken && (
        <Alert variant="destructive">
          <AlertDescription>
            当前没有登录态。上报通道在拿不到 access token 时会直接 return，
            <strong>下面所有按钮都不会真正发出事件</strong>。请先登录再自检。
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {probes.map((probe) => (
          <Card key={probe.id} className="flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Icon name={probe.icon} className="text-primary" />
                {probe.label}
              </CardTitle>
              <CardDescription>{probe.description}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto space-y-3">
              <p className="text-xs text-on-surface-variant">
                预期事件：<code className="font-mono">{probe.expects}</code>
              </p>
              <Button
                type="button"
                className="w-full"
                variant="outline"
                onClick={() => void trigger(probe)}
              >
                触发
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">触发记录</CardTitle>
            <CardDescription>
              事件默认每秒批量上报一次；页面切走或关闭时也会刷一次。
            </CardDescription>
          </div>
          <Button type="button" onClick={() => void flush()} disabled={flushing}>
            {flushing ? "刷新中…" : "立即刷新队列"}
          </Button>
        </CardHeader>
        <CardContent>
          {log.length ? (
            <ul className="divide-y divide-outline-variant text-sm">
              {log.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className="flex items-center gap-3 py-2">
                  <span className="font-mono text-xs text-on-surface-variant">{entry.at}</span>
                  <span className="font-semibold text-on-surface">{entry.label}</span>
                  <code className="ml-auto font-mono text-xs text-on-surface-variant">
                    {entry.expects}
                  </code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-on-surface-variant">
              还没有触发过。点上面任意一张卡片的「触发」开始。
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">事件流向</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-on-surface-variant">
          <p>
            触发后事件先进客户端队列，再 POST 到 model-api 的
            <code className="mx-1 font-mono">/api/telemetry/v1/batch</code>，
            由它写进 CloudWatch Logs，经 Kinesis 交给 cleaner 脱敏，最终落到
            DynamoDB 聚合表与 S3 明细。
          </p>
          <p>
            Sentry 侧要看到 issue，还需要在 <code className="font-mono">apps/performance/sentry</code>
            下跑一次同步；它只转发失败事件，正常 span 会作为面包屑附在错误上。
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default Diagnostics;
