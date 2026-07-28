#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export DOCKER_CONFIG="${SENTRY_DOCKER_CONFIG:-${SCRIPT_DIR}/docker-public}"
cd "${SCRIPT_DIR}/.runtime/self-hosted"
SENTRY_BIND=127.0.0.1:9000 docker compose stop
