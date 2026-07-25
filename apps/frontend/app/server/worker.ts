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
export default httpServerHandler({ port: workerPort });
