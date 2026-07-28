#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="${SCRIPT_DIR}/.runtime"
SENTRY_VERSION="26.5.1"
SENTRY_DIR="${RUNTIME_DIR}/self-hosted"
INSTALL_MARKER="${SENTRY_DIR}/.customer-ops-install-complete"
MINIMUM_COMPOSE_VERSION="2.32.2"
MINIMUM_MEMORY_MIB=14000
SENTRY_PATCH="${SCRIPT_DIR}/patches/0001-optional-compose-pull.patch"
export DOCKER_CONFIG="${SENTRY_DOCKER_CONFIG:-${SCRIPT_DIR}/docker-public}"

resolve_sentry_bash() {
  local candidate

  for candidate in \
    "${SENTRY_BASH:-}" \
    /opt/homebrew/bin/bash \
    /usr/local/bin/bash \
    "$(command -v bash 2>/dev/null || true)"; do
    if [ -n "${candidate}" ] &&
      [ -x "${candidate}" ] &&
      LC_ALL=C LANG=C "${candidate}" -c '(( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) ))'
    then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

remove_appledouble_files() {
  local target="$1"
  local removed_count

  [ -d "${target}" ] || return 0
  removed_count="$(find "${target}" -name '._*' -type f -print | wc -l | tr -d '[:space:]')"
  if [ "${removed_count}" -gt 0 ]; then
    echo "Removing ${removed_count} macOS AppleDouble files from the Sentry build context..."
    find "${target}" -name '._*' -type f -delete
  fi
}

apply_sentry_patches() {
  local target="${SENTRY_DIR}/install/update-docker-images.sh"

  if ! grep -q 'SKIP_COMPOSE_PULL' "${target}"; then
    echo "Applying local Sentry installer compatibility patch..."
    patch --directory="${SENTRY_DIR}" --strip=1 <"${SENTRY_PATCH}"
  fi
}

pull_sentry_images_sequentially() {
  local image
  local attempt

  echo "Checking Sentry images sequentially..."
  {
    docker compose --project-directory "${SENTRY_DIR}" \
      --env-file "${SENTRY_DIR}/.env" config --images
    awk -F= '/^[A-Z0-9_]+_IMAGE=/ { print $2 }' "${SENTRY_DIR}/.env"
  } | sort -u | while IFS= read -r image; do
    case "${image}" in
      ""|*-self-hosted-local) continue ;;
    esac
    if docker image inspect "${image}" >/dev/null 2>&1; then
      echo "Image cached: ${image}"
      continue
    fi
    attempt=1
    until docker pull "${image}"; do
      if (( attempt >= 3 )); then
        echo "Failed to pull ${image} after ${attempt} attempts." >&2
        return 1
      fi
      attempt=$((attempt + 1))
      echo "Retrying ${image} (${attempt}/3)..."
    done
  done
}

if [ -f "${INSTALL_MARKER}" ]; then
  echo "Sentry self-hosted is already installed at ${SENTRY_DIR}"
  exit 0
fi

if ! SENTRY_BASH_BIN="$(resolve_sentry_bash)"; then
  echo "Sentry requires Bash 4.4 or later; macOS /bin/bash is too old." >&2
  echo "Install it with: brew install bash" >&2
  exit 1
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

docker_memory_bytes="$(docker info --format '{{.MemTotal}}' 2>/dev/null || printf '0')"
docker_memory_mib="$((docker_memory_bytes / 1024 / 1024))"
if (( docker_memory_mib < MINIMUM_MEMORY_MIB )); then
  echo "Local Sentry requires at least ${MINIMUM_MEMORY_MIB} MiB of Docker memory; found ${docker_memory_mib} MiB." >&2
  echo "Docker Desktop > Settings > Resources > Advanced: set Memory to at least 14 GB, then Apply & Restart." >&2
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

# External macOS volumes may materialize extended attributes as `._*` files.
# BuildKit interprets those files as xattr metadata and fails while sending a
# Docker build context (for example jq/._Dockerfile on exFAT volumes).
remove_appledouble_files "${SENTRY_DIR}"
apply_sentry_patches
pull_sentry_images_sequentially
(
  cd "${SENTRY_DIR}"
  COPYFILE_DISABLE=1 \
    COPY_EXTENDED_ATTRIBUTES_DISABLE=1 \
    COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-2}" \
    LC_ALL=C \
    LANG=C \
    REPORT_SELF_HOSTED_ISSUES="${REPORT_SELF_HOSTED_ISSUES:-0}" \
    SENTRY_BIND=127.0.0.1:9000 \
    SKIP_COMPOSE_PULL=1 \
    "${SENTRY_BASH_BIN}" ./install.sh --skip-user-creation
)
touch "${INSTALL_MARKER}"

echo "Sentry ${SENTRY_VERSION} installed. Run ./start.sh and open http://127.0.0.1:9000"
