import { describe, expect, it } from "vitest";

import { chatRequestSchema } from "../src/contracts/chat";

describe("chatRequestSchema", () => {
  it("允许普通对话不提供订单号", () => {
    const parsed = chatRequestSchema.safeParse({
      conversationId: "conv-1",
      message: "你是谁？",
    });

    expect(parsed.success).toBe(true);
  });

  it("拒绝空订单号", () => {
    const parsed = chatRequestSchema.safeParse({
      conversationId: "conv-1",
      orderId: "   ",
      message: "查询订单",
    });

    expect(parsed.success).toBe(false);
  });
});
