#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
[ -d user ] && [ -d system/skills ] && [ -f dist/index.js ] || { echo 'Invalid Vito release layout' >&2; exit 1; }
mkdir -p user/logs user/attachments user/pi-agent
export VITO_RELEASE_MODE=1
export VITO_PI_AGENT_DIR="$ROOT/user/pi-agent"
exec node dist/index.js
