#!/usr/bin/env bash
set -euo pipefail

# Run an operator-prepared source checkout while retaining external user state.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"
[ -d user ] && [ -f node_modules/tsx/dist/cli.mjs ] || {
  echo 'Source deployment requires its user directory and installed dev dependencies' >&2
  exit 1
}
unset VITO_RELEASE_MODE
export VITO_PI_AGENT_DIR="${VITO_PI_AGENT_DIR:-$ROOT/user/pi-agent}"
export VITO_LOGS_DIR="${VITO_LOGS_DIR:-$ROOT/user/logs}"
export VITO_ATTACHMENTS_DIR="${VITO_ATTACHMENTS_DIR:-$ROOT/user/attachments}"
export VITO_SOURCE_REVISION="$(git rev-parse HEAD)"
exec node ./node_modules/tsx/dist/cli.mjs src/index.ts
