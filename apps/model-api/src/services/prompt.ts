import type { ChatRequest } from "../contracts/chat";
import type { Order } from "../contracts/order";

export function buildCustomerPrompt(
  request: ChatRequest,
  order?: Order,
): string {
  if (!order) {
    return `用户问题：${request.message}

订单系统查询结果：本轮未提供订单号，因此没有查询订单系统。

请直接回答身份、能力、问候等非订单问题；如果用户需要查询具体订单、物流、退款或售后，请简洁地请用户提供订单号。`;
  }

  return `用户问题：${request.message}

订单系统查询结果（唯一可信数据）：
${JSON.stringify(order)}`;
}
