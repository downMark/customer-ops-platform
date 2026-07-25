export interface OrderContext {
  orderId: string;
  status: string;
  statusText: string;
  carrier: string | null;
  trackingNumber: string | null;
  estimatedDeliveryAt: string | null;
  updatedAt: string;
  items: OrderItem[];
  productSummary: string;
  totalAmountCents: number;
}
export interface OrderItem {
  productId: string;
  productName: string;
  unitPriceCents: number;
  quantity: number;
  subtotalCents: number;
}

export interface OrderPage {
  items: OrderContext[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface OrderListParams {
  page: number;
  pageSize: number;
  orderId?: string;
  status?: string;
}

export interface CreateOrderInput {
  orderId: string;
  status: string;
  carrier?: string;
  trackingNumber?: string;
  estimatedDeliveryAt?: string;
  items: { productId: string; quantity: number }[];
}

export const ORDER_STATUS_OPTIONS = [
  { value: "pending_payment", label: "待付款" },
  { value: "paid", label: "已付款" },
  { value: "processing", label: "处理中" },
  { value: "shipped", label: "已发货" },
  { value: "in_transit", label: "运输中" },
  { value: "out_for_delivery", label: "派送中" },
  { value: "delivered", label: "已签收" },
  { value: "cancelled", label: "已取消" },
  { value: "refund_pending", label: "退款审核中" },
  { value: "refunding", label: "退款处理中" },
  { value: "refunded", label: "已退款" },
  { value: "return_pending", label: "退货审核中" },
  { value: "returning", label: "退货运输中" },
  { value: "after_sale", label: "售后处理中" },
  { value: "delivery_exception", label: "物流异常" },
  { value: "completed", label: "交易完成" },
] as const;
