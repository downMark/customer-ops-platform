import Icon from "components/Icon";
import { OrderContext } from "apis/model/order";

interface Props {
  order: OrderContext;
  mobile?: boolean;
}

const displayTime = (value: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN") : "暂无";

const formatMoney = (cents: number) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(cents / 100);

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
    <div className="min-w-0">
      <p className="text-[10px] text-on-surface-variant font-bold uppercase">
        {label}
      </p>
      <p className="text-body-md font-semibold break-all">{value}</p>
    </div>
  </div>
);

const OrderContextPanel = ({ order, mobile = false }: Props) => (
  <aside
    className={`flex h-full shrink-0 flex-col overflow-y-auto bg-surface-container-lowest ${
      mobile ? "w-full" : "w-80 border-l border-outline-variant lg:w-96"
    }`}
  >
    <div className="border-b border-outline-variant p-4 sm:p-6">
      <h3 className="text-label-sm font-bold uppercase tracking-widest text-on-surface-variant mb-4">
        实时订单信息
      </h3>
      <div className="bg-white border border-outline-variant rounded-xl p-4 shadow-sm">
        <div className="flex justify-between items-start gap-3 mb-4">
          <div>
            <h4 className="font-bold text-body-lg">订单 #{order.orderId}</h4>
            <p className="text-label-sm text-on-surface-variant">
              更新于 {displayTime(order.updatedAt)}
            </p>
          </div>
          <span className="px-2 py-1 bg-tertiary-fixed text-on-tertiary-fixed rounded text-[10px] font-bold whitespace-nowrap">
            {order.statusText}
          </span>
        </div>
        <div className="space-y-4">
          <ContextRow
            icon="local_shipping"
            label="承运商"
            value={order.carrier || "尚未分配"}
          />
          <ContextRow
            icon="pin"
            label="运单号"
            value={order.trackingNumber || "尚未生成"}
          />
          <ContextRow
            icon="event"
            label="预计送达"
            value={displayTime(order.estimatedDeliveryAt)}
          />
        </div>
        <div className="mt-5 border-t border-outline-variant pt-4">
          <p className="mb-3 text-[10px] font-bold uppercase text-on-surface-variant">
            商品明细
          </p>
          <div className="space-y-3">
            {order.items.map((item) => (
              <div
                key={item.productId}
                className="rounded-lg bg-surface-container-low p-3 text-sm"
              >
                <div className="flex justify-between gap-3 font-semibold">
                  <span>{item.productName}</span>
                  <span>{formatMoney(item.subtotalCents)}</span>
                </div>
                <p className="mt-1 text-xs text-on-surface-variant">
                  {formatMoney(item.unitPriceCents)} × {item.quantity}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-between border-t border-outline-variant pt-3 font-bold">
            <span>订单总金额</span>
            <span className="text-primary">
              {formatMoney(order.totalAmountCents)}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div className="mt-auto flex items-center justify-between border-t border-outline-variant bg-surface-container-low p-4 opacity-70 sm:p-6">
      <div className="flex items-center gap-1.5">
        <Icon name="database" className="text-lg" />
        <span className="text-label-sm font-bold tracking-tight">订单服务</span>
      </div>
      <span className="text-label-sm font-bold tracking-tight">
        归属校验已启用
      </span>
    </div>
  </aside>
);

export default OrderContextPanel;
