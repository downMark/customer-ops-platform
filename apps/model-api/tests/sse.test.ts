import { describe, expect, it } from "vitest";

import { encodeSse } from "../src/http/sse";

describe("encodeSse", () => {
  it("生成标准 SSE 事件", () => {
    const event = new TextDecoder().decode(
      encodeSse({ event: "delta", data: { text: "已发货" } }),
    );

    expect(event).toBe('event: delta\ndata: {"text":"已发货"}\n\n');
  });
});
