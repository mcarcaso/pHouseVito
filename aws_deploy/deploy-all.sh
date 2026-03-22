#!/usr/bin/env bash
set -euo pipefail

# ── deploy-all.sh ────────────────────────────────────────────────
# Deploy to all instances in aws_deploy/state/.
#
# Usage:  ./aws_deploy/deploy-all.sh
# ─────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_DIR="$SCRIPT_DIR/state"
KEY_PATH="$HOME/.ssh/vito-deploy.pem"

log()  { echo -e "\033[1;34m→\033[0m $*"; }
ok()   { echo -e "\033[1;32m✓\033[0m $*"; }
warn() { echo -e "\033[1;33m⚠\033[0m $*"; }
die()  { echo -e "\033[1;31m✗\033[0m $*" >&2; exit 1; }

[ -f "$KEY_PATH" ] || die "SSH key not found: $KEY_PATH"

STATE_FILES=("$STATE_DIR"/*.json)
[ ${#STATE_FILES[@]} -gt 0 ] || die "No state files found in $STATE_DIR"

NAMES=()
for f in "${STATE_FILES[@]}"; do
  NAMES+=("$(basename "$f" .json)")
done

log "Deploying to ${#NAMES[@]} instances: ${NAMES[*]}"
echo ""

FAILED=()
SUCCEEDED=()

for NAME in "${NAMES[@]}"; do
  log "[$NAME] Starting deploy …"
  if "$SCRIPT_DIR/deploy.sh" "$NAME"; then
    SUCCEEDED+=("$NAME")
  else
    warn "[$NAME] Deploy failed!"
    FAILED+=("$NAME")
  fi
  echo ""
done

echo "─────────────────────────────────────"
ok "Succeeded (${#SUCCEEDED[@]}): ${SUCCEEDED[*]:-none}"
[ ${#FAILED[@]} -eq 0 ] || warn "Failed (${#FAILED[@]}): ${FAILED[*]}"
[ ${#FAILED[@]} -eq 0 ] || exit 1
