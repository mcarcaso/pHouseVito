#!/usr/bin/env bash
set -euo pipefail

# Idempotent runtime dependency installer for Vito hosts.
# Safe to run on fresh spinup and every deploy.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

log() { echo "[runtime-deps] $*"; }

log "Ensuring Playwright Chromium + OS dependencies..."

# npm ci/install must already have run so local Playwright packages exist.
# --with-deps installs missing apt packages on Linux and is safe to rerun.
npx playwright install --with-deps chromium

# @playwright/mcp currently ships its own pinned Playwright package. Install that
# browser revision too so the built-in MCP server works on fresh hosts without
# relying on a previous npx/cache run.
MCP_PLAYWRIGHT_CLI="node_modules/@playwright/mcp/node_modules/playwright/cli.js"
if [ -f "$MCP_PLAYWRIGHT_CLI" ]; then
  node "$MCP_PLAYWRIGHT_CLI" install --with-deps chromium
fi

log "Runtime dependencies ready."
