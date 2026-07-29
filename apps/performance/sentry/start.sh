#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SENTRY_DIR="${SCRIPT_DIR}/.runtime/self-hosted"
export DOCKER_CONFIG="${SENTRY_DOCKER_CONFIG:-${SCRIPT_DIR}/docker-public}"
if [ ! -f "${SENTRY_DIR}/docker-compose.yml" ]; then
  echo "Run ./install.sh first." >&2
  exit 1
fi
# 与 install.sh 同因：并发拉起全部服务前，先把外置卷的 /host_mnt 路径建好，
# 否则同时 bind-mount 的容器会有一部分报 "mkdir /host_mnt/...: file exists"。
docker run --rm -v "${SENTRY_DIR}:/warm:ro" busybox true >/dev/null 2>&1 || true

cd "${SENTRY_DIR}"
SENTRY_BIND=127.0.0.1:9000 docker compose up --wait --detach
echo "Sentry is available at http://127.0.0.1:9000"
