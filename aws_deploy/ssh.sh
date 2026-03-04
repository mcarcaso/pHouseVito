#!/usr/bin/env bash
set -euo pipefail

# ── ssh.sh ──────────────────────────────────────────────────────────
# Open an SSH session to a customer instance.
#
# Usage:  ./aws_deploy/ssh.sh <name>
# ────────────────────────────────────────────────────────────────────

NAME="${1:?Usage: ssh.sh <name>}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="$SCRIPT_DIR/state/$NAME.json"
KEY_PATH="$HOME/.ssh/vito-deploy.pem"

die()  { echo -e "\033[1;31m✗\033[0m $*" >&2; exit 1; }

[ -f "$STATE_FILE" ] || die "State file not found: $STATE_FILE"
[ -f "$KEY_PATH" ]   || die "SSH key not found: $KEY_PATH"

ELASTIC_IP=$(jq -r '.elastic_ip' "$STATE_FILE")

exec ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "ubuntu@$ELASTIC_IP"
