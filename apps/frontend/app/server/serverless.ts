import path from "node:path";
import { readFileSync } from "node:fs";
import serverless from "serverless-http";
import { createServerApp } from "./index";
import type { ViteManifest } from "./assets";
import { clientBuildPath } from "../../config/paths";

const clientRoot = path.resolve(clientBuildPath);
const manifestPath = path.resolve(clientRoot, ".vite/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as ViteManifest;
const { app } = createServerApp({ clientRoot, manifest });

export const handler = serverless(app);
