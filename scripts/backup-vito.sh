#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="vito-server"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="${VITO_BACKUP_DIR:-$HOME/vito-backups}"
STOP_SERVICE=true
LEAVE_STOPPED=false

usage() {
  cat <<'EOF'
Usage: scripts/backup-vito.sh [options]

Creates a private, compressed backup containing:
  - user/, data/, logs/, SYSTEM.md, .env, and vito.log when present
  - ~/.pi/agent/auth.json when present
  - a Git bundle, committed source snapshot, working-tree snapshot, and patches
  - Git, Node, npm, platform, and PM2 metadata

By default, a running PM2 service named vito-server is stopped while runtime
files are copied and restarted after the backup is complete.

Options:
  --output DIR       Backup destination (default: $VITO_BACKUP_DIR or ~/vito-backups)
  --no-stop          Do not stop Vito; SQLite files may not be transactionally consistent
  --leave-stopped    Stop Vito for the backup and leave it stopped afterward
  -h, --help         Show this help
EOF
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '==> %s\n' "$*"
}

while (($# > 0)); do
  case "$1" in
    --output)
      (($# >= 2)) || die "--output requires a directory"
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --no-stop)
      STOP_SERVICE=false
      shift
      ;;
    --leave-stopped)
      STOP_SERVICE=true
      LEAVE_STOPPED=true
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

umask 077
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
chmod 700 "$OUTPUT_DIR"

case "$OUTPUT_DIR/" in
  "$PROJECT_ROOT/backups/"*) ;;
  "$PROJECT_ROOT/"*) die "Output inside the project must be under $PROJECT_ROOT/backups" ;;
esac

TIMESTAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
HOSTNAME_SAFE="$(hostname 2>/dev/null | tr -cs 'A-Za-z0-9._-' '_' | sed 's/_$//' || printf 'unknown')"
GIT_SHA="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || printf 'no-git')"
BACKUP_NAME="vito-${TIMESTAMP}-${HOSTNAME_SAFE}-${GIT_SHA}"
ARCHIVE_PATH="$OUTPUT_DIR/${BACKUP_NAME}.tar.gz"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vito-backup.XXXXXX")"
BACKUP_ROOT="$STAGING_DIR/$BACKUP_NAME"
RESTART_NEEDED=false

cleanup() {
  local exit_code=$?
  if $RESTART_NEEDED && ! $LEAVE_STOPPED; then
    log "Restarting $SERVICE_NAME"
    if ! pm2 restart "$SERVICE_NAME" --update-env >/dev/null; then
      printf 'Warning: failed to restart %s; restart it manually.\n' "$SERVICE_NAME" >&2
      exit_code=1
    fi
  fi
  rm -rf "$STAGING_DIR"
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$BACKUP_ROOT/runtime" "$BACKUP_ROOT/home/.pi/agent" "$BACKUP_ROOT/repository" "$BACKUP_ROOT/metadata"

if command -v pm2 >/dev/null 2>&1; then
  pm2 jlist > "$BACKUP_ROOT/metadata/pm2-jlist.json" 2>/dev/null || true
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

  if $STOP_SERVICE && [[ "$PM2_STATUS" == "online" || "$PM2_STATUS" == "launching" ]]; then
    log "Stopping $SERVICE_NAME for a consistent backup"
    pm2 stop "$SERVICE_NAME" >/dev/null
    RESTART_NEEDED=true
  elif ! $STOP_SERVICE && [[ "$PM2_STATUS" == "online" || "$PM2_STATUS" == "launching" ]]; then
    printf 'Warning: backing up while %s is running; SQLite consistency is not guaranteed.\n' "$SERVICE_NAME" >&2
  fi
fi

log "Copying runtime data"
for relative_path in user data logs SYSTEM.md .env vito.log; do
  source_path="$PROJECT_ROOT/$relative_path"
  if [[ -e "$source_path" || -L "$source_path" ]]; then
    cp -a "$source_path" "$BACKUP_ROOT/runtime/"
  fi
done

PI_AUTH_PATH="$HOME/.pi/agent/auth.json"
if [[ -f "$PI_AUTH_PATH" ]]; then
  cp -a "$PI_AUTH_PATH" "$BACKUP_ROOT/home/.pi/agent/auth.json"
fi

log "Capturing repository state"
if git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$PROJECT_ROOT" bundle create "$BACKUP_ROOT/repository/repository.bundle" --all
  git -C "$PROJECT_ROOT" archive --format=tar.gz --output="$BACKUP_ROOT/repository/source-at-head.tar.gz" HEAD
  git -C "$PROJECT_ROOT" status --short --branch > "$BACKUP_ROOT/metadata/git-status.txt"
  git -C "$PROJECT_ROOT" log -1 --format=fuller > "$BACKUP_ROOT/metadata/git-head.txt"
  git -C "$PROJECT_ROOT" diff --binary > "$BACKUP_ROOT/repository/working-tree.patch"
  git -C "$PROJECT_ROOT" diff --cached --binary > "$BACKUP_ROOT/repository/staged.patch"
fi

# Capture uncommitted and untracked project files without dependencies, builds,
# runtime directories (already copied above), Git internals, or prior backups.
PROJECT_PARENT="$(dirname "$PROJECT_ROOT")"
PROJECT_NAME="$(basename "$PROJECT_ROOT")"
tar -czf "$BACKUP_ROOT/repository/working-tree.tar.gz" \
  --exclude="./$PROJECT_NAME/.git" \
  --exclude="./$PROJECT_NAME/node_modules" \
  --exclude="./$PROJECT_NAME/dashboard/node_modules" \
  --exclude="./$PROJECT_NAME/dist" \
  --exclude="./$PROJECT_NAME/dashboard/dist" \
  --exclude="./$PROJECT_NAME/user" \
  --exclude="./$PROJECT_NAME/data" \
  --exclude="./$PROJECT_NAME/logs" \
  --exclude="./$PROJECT_NAME/backups" \
  -C "$PROJECT_PARENT" "./$PROJECT_NAME"

{
  printf 'created_utc=%s\n' "$TIMESTAMP"
  printf 'hostname=%s\n' "$HOSTNAME_SAFE"
  printf 'project_root=%s\n' "$PROJECT_ROOT"
  printf 'git_sha=%s\n' "$GIT_SHA"
  printf 'service_name=%s\n' "$SERVICE_NAME"
  printf 'service_stopped_for_backup=%s\n' "$RESTART_NEEDED"
  printf 'node_version=%s\n' "$(node --version 2>/dev/null || printf 'unavailable')"
  printf 'npm_version=%s\n' "$(npm --version 2>/dev/null || printf 'unavailable')"
  printf 'platform=%s\n' "$(uname -a 2>/dev/null || printf 'unavailable')"
} > "$BACKUP_ROOT/metadata/manifest.txt"

log "Creating archive"
tar -czf "$ARCHIVE_PATH" -C "$STAGING_DIR" "$BACKUP_NAME"
chmod 600 "$ARCHIVE_PATH"

ARCHIVE_FILENAME="$(basename "$ARCHIVE_PATH")"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUTPUT_DIR" && sha256sum "$ARCHIVE_FILENAME") > "$ARCHIVE_PATH.sha256"
else
  (cd "$OUTPUT_DIR" && shasum -a 256 "$ARCHIVE_FILENAME") > "$ARCHIVE_PATH.sha256"
fi
chmod 600 "$ARCHIVE_PATH.sha256"

log "Verifying archive"
tar -tzf "$ARCHIVE_PATH" >/dev/null

printf '\nBackup created:\n  %s\n  %s\n' "$ARCHIVE_PATH" "$ARCHIVE_PATH.sha256"
printf 'This archive contains secrets and authentication tokens; store it securely.\n'
