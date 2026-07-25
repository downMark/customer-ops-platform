import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vite";
import { staticBasePath } from "./config/constants";
import {
  clientBuildPath,
  clientEntry,
  serverBuildPath,
  workerBuildPath,
} from "./config/paths";

export default defineConfig(({ isSsrBuild }) => {
  const isWorkerBuild =
    isSsrBuild && process.env.BUILD_RUNTIME === "cloudflare-worker";

  return {
    appType: "custom",
    publicDir: false,
    base: staticBasePath,
    plugins: [react(), tsconfigPaths()],
    build: {
      outDir: isWorkerBuild
        ? workerBuildPath
        : isSsrBuild
          ? serverBuildPath
          : clientBuildPath,
      emptyOutDir: true,
      manifest: !isSsrBuild,
      ssrManifest: !isSsrBuild,
      target: isWorkerBuild ? "es2022" : "es2020",
      rollupOptions: {
        external: isWorkerBuild ? [/^cloudflare:/] : undefined,
        input: isSsrBuild
          ? undefined
          : {
              client: clientEntry,
            },
        output: isSsrBuild
          ? {
              entryFileNames: "[name].js",
              chunkFileNames: "chunks/[name]-[hash].js",
              format: isWorkerBuild ? "es" : "cjs",
              inlineDynamicImports: isWorkerBuild,
            }
          : {
              entryFileNames: "js/[name]-[hash].js",
              chunkFileNames: "js/[name]-[hash].js",
              assetFileNames: "assets/[name]-[hash][extname]",
            },
      },
    },
    ssr: {
      noExternal: isWorkerBuild ? true : ["react-helmet-async"],
    },
    server: {
      hmr: true,
    },
  };
});
