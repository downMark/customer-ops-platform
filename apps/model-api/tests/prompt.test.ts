import { describe, expect, it } from "vitest";

import { buildCustomerPrompt } from "../src/services/prompt";

describe("buildCustomerPrompt", () => {
  it("同时包含客户问题和后端订单事实", () => {
    const prompt = buildCustomerPrompt(
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

  it("没有订单号时允许回答普通问题并约束订单查询", () => {
    const prompt = buildCustomerPrompt({
      conversationId: "conv-2",
      message: "你是谁？",
    });

    expect(prompt).toContain("用户问题：你是谁？");
    expect(prompt).toContain("本轮未提供订单号");
    expect(prompt).toContain("直接回答身份、能力、问候等非订单问题");
  });
});
