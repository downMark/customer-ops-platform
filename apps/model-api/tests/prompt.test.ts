import { describe, expect, it } from "vitest";

import { buildOrderPrompt } from "../src/services/prompt";

describe("buildOrderPrompt", () => {
  it("同时包含客户问题和后端订单事实", () => {
    const prompt = buildOrderPrompt(
      {
        conversationId: "conv-1",
        orderId: "COP-10086",
        message: "订单什么时候到？",
      },
      {
        orderId: "COP-10086",
        status: "shipped",
        statusText: "已发货",
        updatedAt: "2026-07-22T12:00:00Z",
      },
    );

    expect(prompt).toContain("用户问题：订单什么时候到？");
    expect(prompt).toContain('"statusText":"已发货"');
    expect(prompt).toContain("订单系统查询结果（唯一可信数据）");
  });
});
