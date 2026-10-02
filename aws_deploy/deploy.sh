#!/usr/bin/env bash
set -euo pipefail

# Update one prepared source deployment from origin/main.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
usage() { echo 'Usage: aws_deploy/deploy.sh <name>'; }
if [[ "${1:-}" == --help || "${1:-}" == -h ]]; then usage; exit 0; fi
[[ $# == 1 && "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || { usage >&2; exit 2; }
NAME="$1"
STATE_FILE="$SCRIPT_DIR/state/$NAME.json"
KEY_PATH="${VITO_SSH_KEY:-$HOME/.ssh/vito-deploy.pem}"
[[ -f "$STATE_FILE" && -f "$KEY_PATH" ]] || { echo 'Deployment state or SSH key missing' >&2; exit 1; }
ELASTIC_IP="$(jq -er '.elastic_ip' "$STATE_FILE")"
DOMAIN="$(jq -er '.domain' "$STATE_FILE")"
[[ "$ELASTIC_IP" =~ ^[0-9.]+$ && "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || { echo 'Invalid deployment address' >&2; exit 1; }
SSH_ARGS=(-i "$KEY_PATH" -o BatchMode=yes -o StrictHostKeyChecking=yes)
echo "Updating $NAME from main; only vito-server will restart."
ssh "${SSH_ARGS[@]}" "ubuntu@$ELASTIC_IP" python3 - "https://${NAME}.${DOMAIN}/api/health" < "$SCRIPT_DIR/update-source.py"
