#!/usr/bin/env bash
set -euo pipefail

# ── deploy.sh ───────────────────────────────────────────────────────
# Pull latest code and restart Vito on a customer instance.
#
# Usage:  ./aws_deploy/deploy.sh <name>
# ────────────────────────────────────────────────────────────────────

NAME="${1:?Usage: deploy.sh <name>}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="$SCRIPT_DIR/state/$NAME.json"
KEY_PATH="$HOME/.ssh/vito-deploy.pem"

log()  { echo -e "\033[1;34m→\033[0m $*"; }
ok()   { echo -e "\033[1;32m✓\033[0m $*"; }
die()  { echo -e "\033[1;31m✗\033[0m $*" >&2; exit 1; }

[ -f "$STATE_FILE" ] || die "State file not found: $STATE_FILE"
[ -f "$KEY_PATH" ]   || die "SSH key not found: $KEY_PATH"

ELASTIC_IP=$(jq -r '.elastic_ip' "$STATE_FILE")
SSH_OPTS="-i $KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"

log "Deploying to $NAME ($ELASTIC_IP) …"

ssh $SSH_OPTS "ubuntu@$ELASTIC_IP" bash -s << 'REMOTE'
set -euo pipefail
cd /opt/vito
echo ">>> Pulling latest …"
git pull
echo ">>> Installing dependencies …"
npm ci
cd dashboard && npm ci && npm run build && cd ..
echo ">>> Building …"
npm run build
echo ">>> Restarting Vito …"
pm2 restart vito-server
echo ">>> Done!"
REMOTE

ok "Deploy complete for $NAME"
