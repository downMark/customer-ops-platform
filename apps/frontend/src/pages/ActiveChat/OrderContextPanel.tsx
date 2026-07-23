import Icon from "components/Icon";
import { OrderContext } from "apis/model/order";

interface Props {
  order: OrderContext;
}

const ContextRow = ({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) => (
  <div className="flex items-center gap-3">
    <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-primary shrink-0">
      <Icon name={icon} className="text-lg" />
    </div>
    <div>
      <p className="text-[10px] text-on-surface-variant font-bold uppercase">
        {label}
      </p>
      <p className="text-body-md font-semibold">{value}</p>
    </div>
  </div>
);

const OrderContextPanel = ({ order }: Props) => (
  <aside className="w-80 lg:w-96 border-l border-outline-variant bg-surface-container-lowest flex flex-col shrink-0">
    <div className="p-6 border-b border-outline-variant">
      <h3 className="text-label-sm font-bold uppercase tracking-widest text-on-surface-variant mb-4">
        实时订单信息
      </h3>
      <div className="bg-white border border-outline-variant rounded-xl p-4 shadow-sm">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h4 className="font-bold text-body-lg">订单 #{order.orderId}</h4>
            <p className="text-label-sm text-on-surface-variant">
              {order.placedAt}
            </p>
          </div>
          <span className="px-2 py-1 bg-tertiary-fixed text-on-tertiary-fixed rounded text-[10px] font-bold uppercase tracking-tighter">
            {order.statusText}
          </span>
        </div>
        <div className="space-y-4">
          <ContextRow
            icon="location_on"
            label="当前位置"
            value={order.currentLocation}
          />
          <ContextRow
            icon="inventory_2"
            label={`商品（${order.itemsCount} 件）`}
            value={order.itemsSummary}
          />
        </div>
      </div>
    </div>

    <div className="flex-1 p-6 space-y-6 overflow-y-auto">
      <div>
        <h4 className="text-label-sm font-bold uppercase tracking-widest text-on-surface-variant mb-3">
          实时物流地图
        </h4>
        <div className="aspect-square w-full rounded-xl overflow-hidden border border-outline-variant relative bg-secondary-fixed/40">
          <div className="absolute inset-0 bg-primary/5" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-primary rounded-full border-2 border-white shadow-lg animate-ping" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-primary rounded-full border-2 border-white shadow-lg" />
        </div>
      </div>

      <div>
        <h4 className="text-label-sm font-bold uppercase tracking-widest text-on-surface-variant mb-3">
          运输速度
        </h4>
        <div className="h-32 w-full bg-white border border-outline-variant rounded-xl p-3 flex items-end gap-1">
          {order.velocity.map((v, i) => {
            const peak = v === Math.max(...order.velocity);
            return (
              <div
                key={i}
                className={`flex-1 rounded-t transition-all ${
                  peak ? "bg-primary" : "bg-secondary-fixed-dim"
                }`}
                style={{ height: `${Math.round(v * 100)}%` }}
              />
            );
          })}
        </div>
      </div>
    </div>

    <div className="p-6 border-t border-outline-variant bg-surface-container-low flex justify-between items-center opacity-70">
      <div className="flex items-center gap-1.5">
        <Icon name="layers" className="text-lg" />
        <span className="text-label-sm font-bold tracking-tight">Mastra</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Icon name="circle" className="text-lg" />
        <span className="text-label-sm font-bold tracking-tight">Ollama</span>
      </div>
    </div>
  </aside>
);

export default OrderContextPanel;
