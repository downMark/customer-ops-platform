import { spawnSync } from "node:child_process";

const allowedModes = new Set(["local", "prod"]);
const allowedTargets = new Set(["all", "client", "server"]);

const getArgValue = (name) => {
  const args = process.argv.slice(2);
  const arg = args.find((item) => item === name || item.startsWith(`${name}=`));

  if (!arg) return undefined;
  if (arg.includes("=")) return arg.split("=")[1];

  const index = args.indexOf(arg);
  return args[index + 1];
};

const mode = getArgValue("--mode") || process.env.APP_ENV || "prod";
const target = getArgValue("--target") || "all";
const viteMode = mode === "local" ? "development" : mode;

if (!allowedModes.has(mode)) {
  console.error(`Invalid build mode "${mode}". Allowed modes: local, prod.`);
  process.exit(1);
}

if (!allowedTargets.has(target)) {
  console.error(`Invalid build target "${target}". Allowed targets: all, client, server.`);
  process.exit(1);
}

const runVite = (args) => {
  const result = spawnSync("vite", args, {
    stdio: "inherit",
    shell: true,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const buildClient = () => runVite(["build", "--mode", viteMode]);
const buildServer = () =>
  runVite(["build", "--ssr", "app/server/server.ts", "--mode", viteMode]);

if (target === "client") {
  buildClient();
} else if (target === "server") {
  buildServer();
} else {
  buildClient();
  buildServer();
}
