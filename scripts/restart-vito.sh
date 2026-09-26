#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

sync_dependencies() {
  local label="$1"
  local directory="$2"
  shift 2

  local lockfile="$directory/package-lock.json"
  local hidden_lockfile="$directory/node_modules/.package-lock.json"
  local marker="$directory/node_modules/.vito-package-lock.sha256"
  local lock_hash
  lock_hash="$(shasum -a 256 "$lockfile" | awk '{print $1}')"

  if [[ -f "$marker" ]] && [[ "$(cat "$marker")" == "$lock_hash" ]]; then
    echo "[Vito] ${label} dependencies unchanged; skipping npm ci."
    return
  fi

  # Bootstrap the marker for an already synchronized checkout. npm writes its
  # hidden lockfile after installation, so a newer copy means the current
  # package lock has already been applied.
  if [[ ! -f "$marker" ]] && [[ -f "$hidden_lockfile" ]] && [[ ! "$lockfile" -nt "$hidden_lockfile" ]]; then
    printf '%s\n' "$lock_hash" >"$marker"
    echo "[Vito] ${label} dependencies already synchronized; skipping npm ci."
    return
  fi

  echo "[Vito] Synchronizing ${label} dependencies..."
  "$@"
  printf '%s\n' "$lock_hash" >"$marker"
}

sync_dependencies "backend" "." npm ci --include=dev
sync_dependencies "mobile" "mobile" npm --prefix mobile ci --include=dev

echo "[Vito] Building backend..."
npm run build

echo "[Vito] Building companion web client away from the live site..."
WEB_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/vito-web-export.XXXXXXXX")"
trap 'rm -rf "$WEB_STAGE"' EXIT
(cd "$ROOT_DIR/mobile" && ./node_modules/.bin/expo export --platform web --output-dir "$WEB_STAGE")
test -s "$WEB_STAGE/index.html"

# Publish assets first and switch the entry point last. Keep old hashed assets
# so in-flight browser sessions never point at missing JavaScript during cutover.
echo "[Vito] Publishing companion web client..."
node "$ROOT_DIR/scripts/publish-mobile-web.mjs" "$WEB_STAGE" "$ROOT_DIR/mobile/dist"

echo "[Vito] Restarting PM2 service..."
pm2 restart vito-server
