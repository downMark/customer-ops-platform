import { describe, expect, it, vi } from "vitest";

import { BackendClient } from "../src/services/backend-client";

const validOrder = {
  orderId: "COP-10086",
  status: "shipped",
  statusText: "已发货",
  carrier: "测试物流",
  trackingNumber: "TEST-10086",
  estimatedDeliveryAt: "2026-07-25T18:00:00Z",
  updatedAt: "2026-07-22T12:00:00Z",
};

const ok = <T>(data: T) => ({
  code: 200,
  success: true,
  msg: "ok",
  data,
});

describe("BackendClient", () => {
  it("查询订单并透传身份与 trace id", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(ok(validOrder)),
    );
    const client = new BackendClient({
      baseUrl: "http://backend.test",
      fetchImpl,
    });

    await expect(
      client.getOrder({
        orderId: "COP-10086",
        authorization: "Bearer test-token",
        traceId: "trace-123",
      }),
    ).resolves.toEqual(validOrder);

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://backend.test/api/orders/COP-10086",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer test-token",
          "x-trace-id": "trace-123",
        }),
      }),
    );
  });

  it("通过后端登录并解析统一响应", async () => {
    const login = {
      accessToken: "signed-jwt",
      tokenType: "Bearer" as const,
      expiresIn: 86_400,
      user: {
        userId: "test-operator",
        username: "test-operator",
        role: "operator",
      },
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(ok(login)),
    );
    const client = new BackendClient({
      baseUrl: "http://backend.test",
      fetchImpl,
    });

    await expect(
      client.login({
        username: "test-operator",
        password: "correct-password",
      }),
    ).resolves.toEqual(login);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://backend.test/api/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          username: "test-operator",
          password: "correct-password",
        }),
      }),
    );
  });

  it("登录失败不泄露后端账号状态", async () => {
    const client = new BackendClient({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, { status: 401 }),
      ),
    });
    await expect(
      client.login({
        username: "test-operator",
        password: "wrong-password",
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("把后端 404 转换为稳定业务错误", async () => {
    const client = new BackendClient({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, { status: 404 }),
      ),
    });

    await expect(
      client.getOrder({
        orderId: "missing",
        authorization: "Bearer test-token",
        traceId: "trace-123",
      }),
    ).rejects.toMatchObject({
      code: "ORDER_NOT_FOUND",
      status: 404,
      retryable: false,
    });
  });

  it("拒绝不符合契约的后端响应", async () => {
    const client = new BackendClient({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ orderId: "COP-10086" }),
      ),
    });

    await expect(
      client.getOrder({
        orderId: "COP-10086",
        authorization: "Bearer test-token",
        traceId: "trace-123",
      }),
    ).rejects.toMatchObject({
      code: "ORDER_SERVICE_UNAVAILABLE",
      status: 502,
    });
  });
});
