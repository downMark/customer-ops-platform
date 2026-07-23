const ORDER_ID_PATTERN = /\b(?:ADMIN-\d{4}-\d{4}|COP-\d+)\b/i;

/** 从自然语言消息中提取当前项目支持的订单号。 */
export function extractOrderId(message: string): string | null {
  return message.match(ORDER_ID_PATTERN)?.[0].toUpperCase() ?? null;
}
