#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
[ -d user ] && [ -f dist/cli/vito.js ] || { echo 'Invalid Vito release layout' >&2; exit 1; }
export VITO_RELEASE_MODE=1
export VITO_PI_AGENT_DIR="$ROOT/user/pi-agent"
exec node dist/cli/vito.js "$@"
