#!/usr/bin/env bash
set -euo pipefail

# Pull main, install/build, and restart one prepared source deployment in place.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
usage() { echo 'Usage: aws_deploy/deploy.sh <name> [--force]'; }
NAME=""
FORCE=false
for arg in "$@"; do
  case "$arg" in
    --help|-h) usage; exit 0 ;;
    --force) FORCE=true ;;
    *)
      [[ -z "$NAME" && "$arg" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || { usage >&2; exit 2; }
      NAME="$arg"
      ;;
  esac
done
[[ -n "$NAME" ]] || { usage >&2; exit 2; }
STATE_FILE="$SCRIPT_DIR/state/$NAME.json"
KEY_PATH="${VITO_SSH_KEY:-$HOME/.ssh/vito-deploy.pem}"
[[ -f "$STATE_FILE" && -f "$KEY_PATH" ]] || { echo 'Deployment state or SSH key missing' >&2; exit 1; }
ELASTIC_IP="$(jq -er '.elastic_ip' "$STATE_FILE")"
DOMAIN="$(jq -er '.domain' "$STATE_FILE")"
[[ "$ELASTIC_IP" =~ ^[0-9.]+$ && "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || { echo 'Invalid deployment address' >&2; exit 1; }
SSH_ARGS=(-i "$KEY_PATH" -o BatchMode=yes -o StrictHostKeyChecking=yes)
echo "Updating $NAME: pull main, install/build, restart only vito-server."
set --
if [[ "$FORCE" == true ]]; then
  echo 'Forced deployment: rebuild and restart even if already current.'
  set -- --force
fi
ssh "${SSH_ARGS[@]}" "ubuntu@$ELASTIC_IP" python3 - "https://${NAME}.${DOMAIN}/api/health" "$@" < "$SCRIPT_DIR/update-source.py"
