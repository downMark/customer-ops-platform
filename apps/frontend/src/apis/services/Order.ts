import { getApiBaseURL } from "../index";
import {
  CreateOrderInput,
  OrderContext,
  OrderListParams,
  OrderPage,
} from "../model/order";
import AuthService from "./Auth";
import { performanceFetch } from "../../performance";

interface ApiEnvelope<T> {
  code: number;
  success: boolean;
  msg: string;
  data: T | null;
}

class OrderService {
  private static async request<T>(
    path: string,
    init?: RequestInit
  ): Promise<T> {
    const token = AuthService.getAccessToken();
    if (!token) {
      throw new Error("登录状态已失效，请重新登录。");
    }

    const response = await performanceFetch(`${getApiBaseURL()}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const body = (await response.json().catch(() => null)) as
      | ApiEnvelope<T>
      | null;

    if (response.status === 401) {
      AuthService.clearSession();
      throw new Error("登录状态已失效，请重新登录。");
    }
    if (!response.ok || !body?.success || body.data == null) {
      throw new Error(body?.msg || `订单服务暂时不可用 (${response.status})`);
    }
    return body.data;
  }

  static async getOrder(orderId: string): Promise<OrderContext> {
    return this.request<OrderContext>(
      `/api/orders/${encodeURIComponent(orderId)}`
    );
  }

  static async listOrders(params: OrderListParams): Promise<OrderPage> {
    const query = new URLSearchParams({
      page: String(params.page),
      pageSize: String(params.pageSize),
    });
    if (params.orderId) query.set("orderId", params.orderId);
    if (params.status) query.set("status", params.status);
    return this.request<OrderPage>(`/api/orders?${query.toString()}`);
  }

  static async createOrder(input: CreateOrderInput): Promise<OrderContext> {
    return this.request<OrderContext>("/api/orders", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
}

export default OrderService;
