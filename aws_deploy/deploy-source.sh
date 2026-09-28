#!/usr/bin/env bash
set -euo pipefail

# Legacy source-checkout deployment. Retained as an explicit fallback while
# remaining customer instances are migrated to /opt/vito-managed.

NAME="${1:?Usage: deploy-source.sh <name>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="$SCRIPT_DIR/state/$NAME.json"
KEY_PATH="$HOME/.ssh/vito-deploy.pem"

log() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$STATE_FILE" ] || die "State file not found: $STATE_FILE"
[ -f "$KEY_PATH" ] || die "SSH key not found: $KEY_PATH"
ELASTIC_IP="$(jq -r '.elastic_ip' "$STATE_FILE")"
SSH_ARGS=(-i "$KEY_PATH" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)

log "Running legacy source deployment for $NAME ($ELASTIC_IP)"
ssh "${SSH_ARGS[@]}" "ubuntu@$ELASTIC_IP" bash -s <<'REMOTE'
set -euo pipefail
cd /opt/vito
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
NODE_MINOR="$(node -p "process.versions.node.split('.')[1]" 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 19 ]; }; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
git pull
npm ci
./scripts/install-runtime-deps.sh
npm --prefix mobile ci
npm run build:mobile:web
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}" npm run build
pm2 restart vito-server --update-env
pm2 save
REMOTE

ok "Legacy source deploy complete for $NAME"
