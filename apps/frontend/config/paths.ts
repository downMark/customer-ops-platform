import { resolve } from "node:path";

export const rootPath = resolve(__dirname, "..");
export const buildPath = resolve(rootPath, "build");
export const clientBuildPath = resolve(buildPath, "client");
export const serverBuildPath = resolve(buildPath, "server");
export const clientEntry = resolve(rootPath, "app/client/index.tsx");
