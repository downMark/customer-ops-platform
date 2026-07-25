import { resolve } from "node:path";

export const rootPath = resolve(__dirname, "..");
export const buildPath = resolve(rootPath, "build");
export const clientBuildPath = resolve(buildPath, "client", "static");
export const serverBuildPath = resolve(buildPath, "server");
export const workerBuildPath = resolve(buildPath, "worker");
export const clientEntry = resolve(rootPath, "app/client/index.tsx");
