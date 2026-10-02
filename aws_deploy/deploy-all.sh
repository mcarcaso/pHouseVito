#!/usr/bin/env bash
set -euo pipefail
# Deploy only the explicitly selected clients, sequentially; stop on failure.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
[[ $# -gt 0 ]] || { echo 'Usage: aws_deploy/deploy-all.sh <name> [name ...]' >&2; exit 2; }
for name in "$@"; do
  "$SCRIPT_DIR/deploy.sh" "$name"
done
