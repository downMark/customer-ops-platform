#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"
RUNTIME_DIR="${SCRIPT_DIR}/.runtime"
CONSOLE_DIR="${SCRIPT_DIR}/console"
CONSOLE_ENV="${CONSOLE_DIR}/.env"
CONSOLE_PID_FILE="${RUNTIME_DIR}/console.pid"
CONSOLE_LOG="${RUNTIME_DIR}/console.log"
SENTRY_DIR="${SCRIPT_DIR}/sentry/.runtime/self-hosted"
SENTRY_INSTALL_MARKER="${SENTRY_DIR}/.customer-ops-install-complete"
SENTRY_MODE="required"
MINIMUM_SENTRY_MEMORY_MIB=14000

usage() {
  cat <<'EOF'
Usage: ./start.sh [--console-only]

  --console-only Start only the local Console and Kimi AIOps Agent.

Without an option, Sentry is installed when necessary and all local services start.
The AWS performance cleaner is an ECS service and is not started locally.
EOF
}

for argument in "$@"; do
  case "${argument}" in
    --with-sentry) SENTRY_MODE="required" ;;
    --console-only) SENTRY_MODE="disabled" ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: ${argument}" >&2
      usage >&2
      exit 2
      ;;
  esac
done

command -v node >/dev/null 2>&1 || {
  echo "Node.js 22 or later is required." >&2
  exit 1
}
node -e 'const major=Number(process.versions.node.split(".")[0]); if (major < 22) process.exit(1)' || {
  echo "Node.js 22 or later is required; found $(node --version)." >&2
  exit 1
}
command -v corepack >/dev/null 2>&1 || {
  echo "Corepack is required. Install it with Node.js 22." >&2
  exit 1
}
if [ "${SENTRY_MODE}" = "required" ]; then
  command -v docker >/dev/null 2>&1 || {
    echo "Docker is required to install and run local Sentry." >&2
    echo "Install and start Docker Desktop, then run ./start.sh again." >&2
    exit 1
  }
  docker info >/dev/null 2>&1 || {
    echo "Docker is installed but its daemon is not running." >&2
    echo "Start Docker Desktop, then run ./start.sh again." >&2
    exit 1
  }
  docker_memory_bytes="$(docker info --format '{{.MemTotal}}')"
  docker_memory_mib="$((docker_memory_bytes / 1024 / 1024))"
  if (( docker_memory_mib < MINIMUM_SENTRY_MEMORY_MIB )); then
    echo "Local Sentry requires at least ${MINIMUM_SENTRY_MEMORY_MIB} MiB of Docker memory; found ${docker_memory_mib} MiB." >&2
    echo "Docker Desktop > Settings > Resources > Advanced: set Memory to at least 14 GB, then Apply & Restart." >&2
    echo "Use ./start.sh --console-only if this Mac cannot dedicate that memory to Sentry." >&2
    exit 1
  fi
  compose_version="$(docker compose version --short 2>/dev/null || true)"
  if ! node -e '
    const current = process.argv[1].replace(/^v/, "").split(/[.-]/).slice(0, 3).map(Number);
    const minimum = process.argv[2].split(".").map(Number);
    process.exit(current.some((value, index) => value > minimum[index] &&
      current.slice(0, index).every((part, prior) => part === minimum[prior])) ||
      current.every((value, index) => value >= minimum[index] &&
        current.slice(0, index).every((part, prior) => part === minimum[prior])) ? 0 : 1);
  ' "${compose_version}" "2.32.2"; then
    echo "Docker Compose 2.32.2 or later is required; found ${compose_version:-not installed}." >&2
    echo "Upgrade Docker Desktop, restart it, then run ./start.sh again." >&2
    exit 1
  fi
fi

mkdir -p "${RUNTIME_DIR}"
if [ ! -f "${CONSOLE_ENV}" ]; then
  cp "${CONSOLE_DIR}/.env.example" "${CONSOLE_ENV}"
  chmod 600 "${CONSOLE_ENV}"
  echo "Created ${CONSOLE_ENV}; edit it to select demo/AWS mode and configure Kimi."
fi

if [ -f "${CONSOLE_PID_FILE}" ]; then
  existing_pid="$(tr -d '[:space:]' < "${CONSOLE_PID_FILE}")"
  if [ -n "${existing_pid}" ] && kill -0 "${existing_pid}" 2>/dev/null; then
    echo "Performance Console is already running with PID ${existing_pid}."
  else
    rm -f "${CONSOLE_PID_FILE}"
  fi
fi

if [ ! -f "${CONSOLE_PID_FILE}" ]; then
  if [ ! -d "${SCRIPT_DIR}/agent/node_modules" ]; then
    corepack pnpm --dir "${SCRIPT_DIR}/agent" install --frozen-lockfile
  fi
  if [ ! -d "${CONSOLE_DIR}/node_modules" ]; then
    corepack pnpm --dir "${CONSOLE_DIR}" install --frozen-lockfile
  fi

  corepack pnpm --dir "${SCRIPT_DIR}/agent" build
  corepack pnpm --dir "${CONSOLE_DIR}" build

  (
    cd "${CONSOLE_DIR}"
    NODE_ENV=production nohup node --env-file-if-exists=.env \
      dist-server/server.js >>"${CONSOLE_LOG}" 2>&1 &
    echo "$!" > "${CONSOLE_PID_FILE}"
  )

  console_pid="$(tr -d '[:space:]' < "${CONSOLE_PID_FILE}")"
  console_port="$(
    awk -F= '$1 == "PERFORMANCE_CONSOLE_PORT" { gsub(/[[:space:]\r]/, "", $2); print $2; exit }' \
      "${CONSOLE_ENV}"
  )"
  console_port="${console_port:-4318}"

  healthy="false"
  for _attempt in $(seq 1 30); do
    if curl --fail --silent "http://127.0.0.1:${console_port}/api/health" >/dev/null 2>&1; then
      healthy="true"
      break
    fi
    if ! kill -0 "${console_pid}" 2>/dev/null; then
      break
    fi
    sleep 1
  done

  if [ "${healthy}" != "true" ]; then
    echo "Performance Console failed to become healthy. See ${CONSOLE_LOG}." >&2
    exit 1
  fi
  echo "Performance Console: http://127.0.0.1:${console_port}"
fi

if [ "${SENTRY_MODE}" = "required" ] && [ ! -f "${SENTRY_INSTALL_MARKER}" ]; then
  "${SCRIPT_DIR}/sentry/install.sh"
fi
if [ "${SENTRY_MODE}" != "disabled" ] && [ -f "${SENTRY_DIR}/docker-compose.yml" ]; then
  "${SCRIPT_DIR}/sentry/start.sh"
  "${SCRIPT_DIR}/sentry/health.sh"
  echo "Sentry: http://127.0.0.1:9000"
fi

if ! grep -Eq '^MOONSHOT_API_KEY=.+$' "${CONSOLE_ENV}"; then
  echo "Kimi K3 API Key is not configured; AIOps will use deterministic rules."
fi

echo "Runtime log: ${CONSOLE_LOG}"
echo "Stop local services with: ${SCRIPT_DIR}/stop.sh"
