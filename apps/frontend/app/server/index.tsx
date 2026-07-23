import Koa from "koa";
import Router from "@koa/router";
import mount from "koa-mount";
import serve from "koa-static";
import type { ViteDevServer } from "vite";
import {
  getDevAssetTags,
  getProdAssetTags,
  type ViteManifest,
} from "./assets";
import { staticMountPath } from "../../config/constants";

interface CreateServerAppOptions {
  clientRoot?: string;
  manifest?: ViteManifest;
  vite?: ViteDevServer;
}

const shouldIgnoreRequest = (path: string) =>
  path === "/favicon.ico" || path.startsWith("/.well-known/");

export const createServerApp = ({
  clientRoot,
  manifest,
  vite,
}: CreateServerAppOptions = {}) => {
  const app = new Koa();
  const router = new Router();
  const assetTags = vite
    ? getDevAssetTags()
    : manifest
      ? getProdAssetTags(manifest)
      : { links: "", scripts: "" };

  if (vite) {
    app.use(async (ctx, next) => {
      await new Promise<void>((resolve, reject) => {
        vite.middlewares(ctx.req, ctx.res, (error?: unknown) => {
          if (error) reject(error);
          else resolve();
        });
      });

      if (!ctx.res.writableEnded) {
        await next();
      }
    });
  }

  if (clientRoot) {
    app.use(mount(staticMountPath, serve(clientRoot)));
  }

  router.get("(.*)", async (ctx) => {
    if (shouldIgnoreRequest(ctx.path)) {
      ctx.status = 204;
      return;
    }

    try {
      if (vite) {
        const mod = await vite.ssrLoadModule("/app/server/render.tsx");
        await mod.renderRequest(ctx, {
          assetTags,
          transformHtml: (html: string) => vite.transformIndexHtml(ctx.url, html),
        });
        return;
      }

      const mod = await import("./render");
      await mod.renderRequest(ctx, { assetTags });
    } catch (error) {
      if (vite) {
        vite.ssrFixStacktrace(error as Error);
      }
      console.error(error);
      ctx.status = 500;
      ctx.body = "Internal Server Error";
    }
  });

  app.use(router.routes()).use(router.allowedMethods());

  return { app, router };
};

const { app, router } = createServerApp();

export { router };
export default app;
