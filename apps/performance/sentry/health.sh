#!/usr/bin/env bash
set -euo pipefail

curl --fail --silent --show-error http://127.0.0.1:9000/_health/ >/dev/null
echo "Sentry is healthy."
