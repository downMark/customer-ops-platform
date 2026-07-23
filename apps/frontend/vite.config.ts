import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vite";
import { staticBasePath } from "./config/constants";
import { clientBuildPath, clientEntry, serverBuildPath } from "./config/paths";

export default defineConfig(({ isSsrBuild }) => ({
  appType: "custom",
  publicDir: false,
  base: staticBasePath,
  plugins: [react(), tsconfigPaths()],
  build: {
    outDir: isSsrBuild ? serverBuildPath : clientBuildPath,
    emptyOutDir: true,
    manifest: !isSsrBuild,
    ssrManifest: !isSsrBuild,
    target: "es2020",
    rollupOptions: {
      input: isSsrBuild
        ? undefined
        : {
            client: clientEntry,
          },
      output: isSsrBuild
        ? {
            entryFileNames: "[name].js",
            chunkFileNames: "chunks/[name]-[hash].js",
            format: "cjs",
          }
        : {
            entryFileNames: "js/[name]-[hash].js",
            chunkFileNames: "js/[name]-[hash].js",
            assetFileNames: "assets/[name]-[hash][extname]",
          },
    },
  },
  ssr: {
    noExternal: ["react-helmet-async"],
  },
  server: {
    hmr: true,
  },
}));
