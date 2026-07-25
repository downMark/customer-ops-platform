const ORDER_ID_PATTERN = /\b[A-Z0-9]+(?:[-_][A-Z0-9]+)+\b/i;

/** 从自然语言消息中提取后端允许的、带分隔符的订单号。 */
export function extractOrderId(message: string): string | null {
  return message.match(ORDER_ID_PATTERN)?.[0].toUpperCase() ?? null;
}
