import { createServer } from "node:http";
import { httpServerHandler } from "cloudflare:node";

import { createServerApp } from "./index";
import type { ViteManifest } from "./assets";

// Client assets are built first. Vite resolves this glob while bundling the
// Worker, so no filesystem access is required at runtime.
const manifestModules = import.meta.glob(
  "../../build/client/static/.vite/manifest.json",
  {
    eager: true,
    import: "default",
  }
);
const manifest = Object.values(manifestModules)[0] as
  | ViteManifest
  | undefined;

if (!manifest) {
  throw new Error(
    "Client manifest is missing. Run the Cloudflare worker build command."
  );
}

const { app } = createServerApp({ manifest });
const server = createServer(app.callback());
const workerPort = 8080;
server.listen(workerPort);

// The port is only an in-process routing key in Workers; no socket is opened.
const appHandler = httpServerHandler({ port: workerPort });

const worker: ExportedHandler<Env> = {
  async fetch(request, env, context) {
    const requestUrl = new URL(request.url);
    const proxy =
      requestUrl.pathname === "/model-api" ||
      requestUrl.pathname.startsWith("/model-api/")
        ? {
            prefix: "/model-api",
            upstreamBaseUrl: env.MODEL_API_BASE_URL,
          }
        : requestUrl.pathname === "/backend-api" ||
            requestUrl.pathname.startsWith("/backend-api/")
          ? {
              prefix: "/backend-api",
              upstreamBaseUrl: env.SSR_API_BASE_URL,
            }
          : undefined;
    if (proxy) {
      const upstreamBaseUrl = proxy.upstreamBaseUrl?.replace(/\/$/, "");
      if (!upstreamBaseUrl) {
        return new Response("Upstream API URL is not configured", {
          status: 503,
        });
      }
      const upstreamPath =
        requestUrl.pathname.slice(proxy.prefix.length) || "/";
      const upstreamUrl = new URL(
        `${upstreamPath}${requestUrl.search}`,
        `${upstreamBaseUrl}/`,
      );
      const headers = new Headers(request.headers);
      headers.delete("host");
      headers.set("x-forwarded-host", requestUrl.host);
      headers.set("x-forwarded-proto", requestUrl.protocol.replace(":", ""));
      return fetch(
        new Request(upstreamUrl, {
          method: request.method,
          headers,
          body:
            request.method === "GET" || request.method === "HEAD"
              ? undefined
              : request.body,
          redirect: "manual",
        }),
      );
    }
    if (!appHandler.fetch) {
      return new Response("Worker handler is unavailable", { status: 500 });
    }
    return appHandler.fetch(request, env, context);
  },
};

export default worker;
