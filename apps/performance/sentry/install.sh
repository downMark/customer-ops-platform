#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="${SCRIPT_DIR}/.runtime"
SENTRY_VERSION="26.5.1"

if [ -d "${RUNTIME_DIR}/self-hosted/.git" ]; then
  echo "Sentry self-hosted is already installed at ${RUNTIME_DIR}/self-hosted"
  exit 0
fi

mkdir -p "${RUNTIME_DIR}"
git clone --branch "${SENTRY_VERSION}" --depth 1 \
  https://github.com/getsentry/self-hosted.git \
  "${RUNTIME_DIR}/self-hosted"
(
  cd "${RUNTIME_DIR}/self-hosted"
  SENTRY_BIND=127.0.0.1:9000 ./install.sh --skip-user-creation
)

echo "Sentry ${SENTRY_VERSION} installed. Run ./start.sh and open http://127.0.0.1:9000"
