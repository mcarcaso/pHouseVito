#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[Vito] Synchronizing backend dependencies..."
npm ci --include=dev

echo "[Vito] Synchronizing dashboard dependencies..."
npm --prefix dashboard ci --include=dev

echo "[Vito] Building backend..."
npm run build

echo "[Vito] Building dashboard..."
npm run build:dashboard

echo "[Vito] Restarting PM2 service..."
pm2 restart vito-server
