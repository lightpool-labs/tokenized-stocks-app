#!/usr/bin/env bash
# Start the local stock stack by calling lightpool-tutorials/scripts/start-stocks-07.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LABS="$(cd "$APP_ROOT/.." && pwd)"
TARGET="$LABS/lightpool-tutorials/scripts/start-stocks-07.sh"

if [[ ! -x "$TARGET" ]]; then
  echo "start script not found: $TARGET" >&2
  echo "run ./scripts/download-and-build.sh first" >&2
  exit 1
fi

export LABS
exec "$TARGET" "$@"
