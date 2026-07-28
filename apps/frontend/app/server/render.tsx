import type { Context } from "koa";
import { createQueryClient } from "@app/utils/queryClient";
import { prefetch, renderApp } from "./app";
import { response } from "./stream/response";
import type { AssetTags } from "./assets";
import { createPerformanceMonitor } from "@app/utils/performance";

interface RenderRequestOptions {
  assetTags: AssetTags;
  transformHtml?: (html: string) => string | Promise<string>;
}

const serializeJson = (value: unknown) =>
  JSON.stringify(value).replace(/[<>&]/g, (char) => {
    switch (char) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      case "&":
        return "\\u0026";
      default:
        return char;
    }
  });

export const renderRequest = async (
  ctx: Context,
  { assetTags, transformHtml }: RenderRequestOptions
) => {
  const queryClient = createQueryClient();
  const monitor = createPerformanceMonitor();

  try {
    ctx.set("Content-Type", "text/html");
    const { dehydratedState } = await prefetch(ctx, queryClient);
    monitor.markPrefetchComplete();
    const { jsx, helmetContext } = renderApp(ctx, queryClient, dehydratedState);

    await response(
      ctx,
      jsx,
      {
        helmetContext,
        assetTags,
      },
      {
        dehydratedState: serializeJson(dehydratedState),
        assetTags,
      },
      {
        transformHtml,
      }
    );
    monitor.markRenderComplete();
  } finally {
    monitor.finish();
    queryClient.clear();
  }
};
