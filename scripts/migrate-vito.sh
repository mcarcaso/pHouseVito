#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="vito-server"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_ARGS=(--leave-stopped)
WAS_RUNNING=false

usage() {
  cat <<'EOF'
Usage: scripts/migrate-vito.sh [options]

Creates and verifies a pre-migration backup, installs dependencies, verifies
and builds the application, rewrites user/vito.config.json to the current
schema, and preserves the existing PM2 running state.

Options:
  --output DIR   Backup destination (default: $VITO_BACKUP_DIR or ~/vito-backups)
  --full         Create a full disaster-recovery backup
  -h, --help     Show this help
EOF
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

while (($# > 0)); do
  case "$1" in
    --output)
      (($# >= 2)) || die "--output requires a directory"
      BACKUP_ARGS+=(--output "$2")
      shift 2
      ;;
    --full)
      BACKUP_ARGS+=(--full)
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

if command -v pm2 >/dev/null 2>&1; then
  PM2_STATUS="$(pm2 jlist 2>/dev/null | node -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      try {
        const processInfo = JSON.parse(input).find(item => item.name === process.argv[1]);
        process.stdout.write(processInfo?.pm2_env?.status ?? "missing");
      } catch {
        process.stdout.write("unknown");
      }
    });
  ' "$SERVICE_NAME" 2>/dev/null || printf 'unknown')"
  if [[ "$PM2_STATUS" == "online" || "$PM2_STATUS" == "launching" ]]; then
    WAS_RUNNING=true
  fi
fi

cleanup() {
  local exit_code=$?
  if $WAS_RUNNING; then
    printf '==> Restarting %s\n' "$SERVICE_NAME"
    if ! pm2 restart "$SERVICE_NAME" --update-env >/dev/null; then
      printf 'Warning: failed to restart %s; restart it manually.\n' "$SERVICE_NAME" >&2
      exit_code=1
    fi
  fi
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$PROJECT_ROOT"
printf '==> Creating pre-migration backup\n'
"$SCRIPT_DIR/backup-vito.sh" "${BACKUP_ARGS[@]}"

printf '==> Installing backend dependencies\n'
npm ci --include=dev

printf '==> Installing dashboard dependencies\n'
npm --prefix dashboard ci --include=dev

printf '==> Installing mobile dependencies\n'
npm --prefix mobile ci --include=dev

printf '==> Installing runtime dependencies\n'
"$SCRIPT_DIR/install-runtime-deps.sh"

printf '==> Running verification\n'
npm run check

printf '==> Building backend\n'
npm run build

printf '==> Building dashboard\n'
npm run build:dashboard

# Migrate only after the new code has installed, verified, and built. If an
# earlier step fails, the existing configuration remains untouched.
printf '==> Migrating Vito configuration\n'
./vito config migrate user/vito.config.json

printf '\nMigration complete. To roll back, run scripts/restore-vito.sh with the backup archive printed above.\n'
