import path from "node:path";
import { readFile } from "node:fs/promises";
import { createServerApp } from "./index";
import type { ViteManifest } from "./assets";
import { defaultPort } from "../../config/constants";

const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? defaultPort);

const createApp = async () => {
  if (!isProduction) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      appType: "custom",
      server: {
        middlewareMode: true,
      },
    });

    return createServerApp({ vite }).app;
  }

  // This file is emitted to build/server; client assets are a sibling tree.
  const clientRoot = path.resolve(__dirname, "../client/static");
  const manifestPath = path.resolve(clientRoot, ".vite/manifest.json");
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf-8")
  ) as ViteManifest;

  return createServerApp({
    clientRoot,
    manifest,
  }).app;
};

createApp()
  .then((app) => {
    app.listen(port, () => {
      console.log(`SSR server is listening on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start SSR server:", error);
    process.exit(1);
  });
