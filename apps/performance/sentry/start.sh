#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SENTRY_DIR="${SCRIPT_DIR}/.runtime/self-hosted"
if [ ! -f "${SENTRY_DIR}/docker-compose.yml" ]; then
  echo "Run ./install.sh first." >&2
  exit 1
fi
cd "${SENTRY_DIR}"
SENTRY_BIND=127.0.0.1:9000 docker compose up --wait --detach
echo "Sentry is available at http://127.0.0.1:9000"
