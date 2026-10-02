#!/usr/bin/env bash
set -euo pipefail
# Copy this launcher into the source installation root as run-current.sh.
ROOT="$(cd "$(dirname "$0")" && pwd -P)"
TARGET="$(realpath "$ROOT/current")"
[ "$(dirname "$TARGET")" = "$ROOT/checkouts" ] || {
  echo 'Source current must resolve to a checkout in this installation' >&2
  exit 1
}
cd "$TARGET"
exec ./scripts/run-source.sh
