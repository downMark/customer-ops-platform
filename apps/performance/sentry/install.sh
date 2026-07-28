#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="${SCRIPT_DIR}/.runtime"
SENTRY_VERSION="26.5.1"
SENTRY_DIR="${RUNTIME_DIR}/self-hosted"
INSTALL_MARKER="${SENTRY_DIR}/.customer-ops-install-complete"
MINIMUM_COMPOSE_VERSION="2.32.2"

if [ -f "${INSTALL_MARKER}" ]; then
  echo "Sentry self-hosted is already installed at ${SENTRY_DIR}"
  exit 0
fi

compose_version="$(docker compose version --short 2>/dev/null || true)"
compose_core="${compose_version#v}"
compose_core="${compose_core%%-*}"
IFS=. read -r compose_major compose_minor compose_patch <<< "${compose_core:-0.0.0}"
IFS=. read -r minimum_major minimum_minor minimum_patch <<< "${MINIMUM_COMPOSE_VERSION}"
if (( compose_major < minimum_major ||
      (compose_major == minimum_major && compose_minor < minimum_minor) ||
      (compose_major == minimum_major && compose_minor == minimum_minor && compose_patch < minimum_patch) )); then
  echo "Docker Compose ${MINIMUM_COMPOSE_VERSION} or later is required; found ${compose_version:-not installed}." >&2
  echo "Upgrade Docker Desktop, restart it, then run ./start.sh again." >&2
  exit 1
fi

mkdir -p "${RUNTIME_DIR}"
if [ ! -d "${SENTRY_DIR}/.git" ]; then
  git clone --branch "${SENTRY_VERSION}" --depth 1 \
    https://github.com/getsentry/self-hosted.git \
    "${SENTRY_DIR}"
else
  echo "Resuming the incomplete Sentry installation at ${SENTRY_DIR}"
fi
(
  cd "${SENTRY_DIR}"
  REPORT_SELF_HOSTED_ISSUES="${REPORT_SELF_HOSTED_ISSUES:-0}" \
    SENTRY_BIND=127.0.0.1:9000 \
    ./install.sh --skip-user-creation
)
touch "${INSTALL_MARKER}"

echo "Sentry ${SENTRY_VERSION} installed. Run ./start.sh and open http://127.0.0.1:9000"
