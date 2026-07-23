import Icon from "components/Icon";

const OrderHistory = () => (
  <div className="h-full overflow-y-auto">
    <div className="p-gutter max-w-container-max mx-auto">
      <div className="mb-8">
        <h2 className="text-display-lg font-display-lg text-on-surface">
          订单历史
        </h2>
        <p className="text-body-lg text-on-surface-variant">
          查看过往会话和已解决的订单咨询。
        </p>
      </div>
      <div className="bento-card rounded-xl p-12 flex flex-col items-center justify-center text-center text-on-surface-variant">
        <Icon name="history" className="text-5xl mb-4 text-outline" />
        <p className="text-body-lg font-semibold">即将上线</p>
        <p className="text-body-md">
          订单历史将展示已完成的会话及其处理记录。
        </p>
      </div>
    </div>
  </div>
);

export default OrderHistory;
