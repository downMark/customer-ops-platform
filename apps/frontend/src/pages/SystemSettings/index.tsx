import { useQuery } from "@tanstack/react-query";
import { PrefetchKeys } from "apis/queryKeys";
import SystemService from "apis/services/System";
import { ServiceState, ServiceStatusItem } from "apis/model/system";
import Icon from "components/Icon";
import TestButton from "./TestButton";

const STATE_DOT: Record<ServiceState, string> = {
  ok: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
};

const CardHeader = ({
  icon,
  iconWrap,
  iconColor,
  title,
  subtitle,
}: {
  icon: string;
  iconWrap: string;
  iconColor: string;
  title: string;
  subtitle: string;
}) => (
  <div className="flex items-center gap-3">
    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${iconWrap}`}>
      <Icon name={icon} className={iconColor} />
    </div>
    <div>
      <h3 className="text-headline-md font-headline-md">{title}</h3>
      <p className="text-label-sm text-on-surface-variant">{subtitle}</p>
    </div>
  </div>
);

const StatusChip = ({ item }: { item: ServiceStatusItem }) => (
  <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-outline-variant">
    <div
      className={`w-2 h-2 rounded-full ${STATE_DOT[item.state]} ${
        item.state === "ok" ? "animate-pulse" : ""
      }`}
    />
    <div>
      <p className="text-xs text-on-surface-variant">{item.name}</p>
      <p className="text-label-sm font-bold">{item.detail}</p>
    </div>
  </div>
);

const SystemSettings = () => {
  const { data: view } = useQuery({
    queryKey: [PrefetchKeys.SETTINGS_VIEW],
    queryFn: () => SystemService.getSettingsView(),
  });

  if (!view) return null;
  const { endpoints, inference, rules, status } = view;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-gutter max-w-container-max mx-auto">
        {/* Page header */}
        <div className="mb-8">
          <h2 className="text-display-lg font-display-lg text-on-surface">
            系统设置
          </h2>
          <p className="text-body-lg text-on-surface-variant">
            配置核心智能能力与服务集成。
          </p>
        </div>

        <div className="grid grid-cols-12 gap-gutter">
          {/* Left column */}
          <div className="col-span-12 lg:col-span-7 space-y-gutter">
            {/* Service Endpoints */}
            <section className="bento-card rounded-xl p-6">
              <div className="mb-6">
                <CardHeader
                  icon="dns"
                  iconWrap="bg-primary-container"
                  iconColor="text-white"
                  title="服务端点"
                  subtitle="将 Mastra 接入您的后端服务"
                />
              </div>
              <div className="space-y-6">
                {endpoints.map((ep) => (
                  <div key={ep.key} className="space-y-2">
                    <label className="text-label-sm text-on-surface-variant uppercase tracking-wider block">
                      {ep.label}
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Icon
                          name={ep.icon}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg"
                        />
                        <input
                          type="text"
                          defaultValue={ep.value}
                          className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-outline-variant input-focus-halo text-body-md"
                        />
                      </div>
                      <TestButton label="测试连接" />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Inference Engine */}
            <section className="bento-card rounded-xl p-6">
              <div className="mb-6">
                <CardHeader
                  icon="psychology"
                  iconWrap="bg-tertiary-container"
                  iconColor="text-white"
                  title="推理引擎"
                  subtitle="通过 Ollama 配置本地大语言模型"
                />
              </div>
              <div className="space-y-2">
                <label className="text-label-sm text-on-surface-variant uppercase tracking-wider block">
                  当前 Ollama 模型
                </label>
                <div className="flex gap-2">
                  <select
                    defaultValue={inference.active}
                    className="flex-1 py-2.5 px-4 rounded-lg border border-outline-variant input-focus-halo text-body-md bg-white"
                  >
                    {inference.models.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <TestButton label="测试模型" />
                </div>
                <p className="text-xs text-on-surface-variant italic">
                  {inference.note}
                </p>
              </div>
            </section>
          </div>

          {/* Right column: rules */}
          <div className="col-span-12 lg:col-span-5">
            <section className="bento-card rounded-xl p-6 h-full flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <CardHeader
                  icon="gavel"
                  iconWrap="bg-surface-variant"
                  iconColor="text-primary"
                  title="客服规则"
                  subtitle="模型指令与约束"
                />
                <span className="px-2 py-1 bg-tertiary-fixed text-on-tertiary-fixed text-[10px] rounded font-bold whitespace-nowrap">
                  {rules.version}
                </span>
              </div>
              <div className="flex-1 flex flex-col space-y-4">
                <label className="text-label-sm text-on-surface-variant uppercase tracking-wider">
                  系统提示词 / 模型指令
                </label>
                <textarea
                  defaultValue={rules.systemPrompt}
                  placeholder="在此输入系统指令…"
                  className="flex-1 min-h-48 w-full p-4 rounded-lg border border-outline-variant input-focus-halo text-body-md font-mono bg-surface-container-lowest resize-none leading-relaxed"
                />
                <div className="flex items-center justify-between pt-4 border-t border-outline-variant">
                  <span className="text-xs text-on-surface-variant">
                    最后更新：{rules.lastUpdated}
                  </span>
                  <button
                    type="button"
                    className="px-6 py-2.5 bg-primary text-white font-label-sm rounded-lg hover:bg-primary-container transition-all"
                  >
                    应用指令
                  </button>
                </div>
              </div>
            </section>
          </div>

          {/* Live status */}
          <div className="col-span-12">
            <section className="bento-card rounded-xl p-6 bg-surface-container-low">
              <h3 className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-wider mb-4">
                实时服务状态
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {status.map((item) => (
                  <StatusChip key={item.key} item={item} />
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SystemSettings;
