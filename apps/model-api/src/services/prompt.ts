import type { ChatRequest } from "../contracts/chat";
import type { Order } from "../contracts/order";

export function buildOrderPrompt(request: ChatRequest, order: Order): string {
  return `用户问题：${request.message}

订单系统查询结果（唯一可信数据）：
${JSON.stringify(order)}`;
}
