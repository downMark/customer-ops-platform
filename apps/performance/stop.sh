#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"
CONSOLE_PID_FILE="${SCRIPT_DIR}/.runtime/console.pid"

if [ -f "${CONSOLE_PID_FILE}" ]; then
  console_pid="$(tr -d '[:space:]' < "${CONSOLE_PID_FILE}")"
  if [ -n "${console_pid}" ] && kill -0 "${console_pid}" 2>/dev/null; then
    kill "${console_pid}"
    for _attempt in $(seq 1 10); do
      kill -0 "${console_pid}" 2>/dev/null || break
      sleep 1
    done
    echo "Performance Console stopped."
  else
    echo "Performance Console was not running."
  fi
  rm -f "${CONSOLE_PID_FILE}"
else
  echo "Performance Console was not running."
fi

if [ -f "${SCRIPT_DIR}/sentry/.runtime/self-hosted/docker-compose.yml" ]; then
  "${SCRIPT_DIR}/sentry/stop.sh"
fi
