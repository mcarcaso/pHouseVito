#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="vito-server"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RESTORE_CODE=false
SKIP_BUILD=false
ASSUME_YES=false

usage() {
  cat <<'EOF'
Usage: scripts/restore-vito.sh BACKUP.tar.gz [options]

Safely restores a backup created by scripts/backup-vito.sh.

Default behavior:
  - verifies the companion SHA-256 checksum when present
  - shows the backup manifest and asks for confirmation
  - records whether vito-server is currently running
  - creates a new pre-restore backup and leaves Vito stopped
  - moves the runtime files being replaced into a safety directory
  - restores the archive's runtime data while preserving paths omitted from upgrade backups
  - reinstalls dependencies, validates config, and rebuilds
  - restarts Vito only if it was running before the restore

Options:
  --restore-code    Also restore the backed-up Git/source working tree
  --skip-build      Skip npm install, config validation, and builds
  -y, --yes         Do not ask for interactive confirmation
  -h, --help        Show this help

Without --restore-code, the current checked-out application code is retained.
EOF
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '==> %s\n' "$*"
}

[[ $# -gt 0 ]] || { usage >&2; exit 1; }
BACKUP_PATH=""

while (($# > 0)); do
  case "$1" in
    --restore-code)
      RESTORE_CODE=true
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    -y|--yes)
      ASSUME_YES=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      die "Unknown option: $1"
      ;;
    *)
      [[ -z "$BACKUP_PATH" ]] || die "Only one backup archive may be specified"
      BACKUP_PATH="$1"
      shift
      ;;
  esac
done

[[ -n "$BACKUP_PATH" ]] || die "A backup archive is required"
[[ -f "$BACKUP_PATH" ]] || die "Backup not found: $BACKUP_PATH"
BACKUP_PATH="$(cd "$(dirname "$BACKUP_PATH")" && pwd)/$(basename "$BACKUP_PATH")"
[[ "$BACKUP_PATH" == *.tar.gz ]] || die "Expected a .tar.gz backup"

umask 077
RESTORE_TEMP="$(mktemp -d "${TMPDIR:-/tmp}/vito-restore.XXXXXX")"
WAS_RUNNING=false
SERVICE_STOPPED=false

cleanup() {
  local exit_code=$?
  rm -rf "$RESTORE_TEMP"
  if [[ $exit_code -ne 0 ]]; then
    printf '\nRestore did not complete.\n' >&2
    if $SERVICE_STOPPED; then
      printf 'Vito has been left stopped for safety.\n' >&2
      printf 'Use the pre-restore archive or safety directory reported above to roll back.\n' >&2
    else
      printf 'The service state was not changed.\n' >&2
    fi
  fi
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

CHECKSUM_PATH="$BACKUP_PATH.sha256"
if [[ -f "$CHECKSUM_PATH" ]]; then
  log "Verifying backup checksum"
  CHECKSUM_DIR="$(dirname "$BACKUP_PATH")"
  CHECKSUM_FILE="$(basename "$CHECKSUM_PATH")"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$CHECKSUM_DIR" && sha256sum -c "$CHECKSUM_FILE")
  else
    (cd "$CHECKSUM_DIR" && shasum -a 256 -c "$CHECKSUM_FILE")
  fi
else
  printf 'Warning: checksum not found: %s\n' "$CHECKSUM_PATH" >&2
fi

log "Inspecting backup archive"
ARCHIVE_LIST="$RESTORE_TEMP/archive-list.txt"
tar -tzf "$BACKUP_PATH" > "$ARCHIVE_LIST"
if grep -Eq '(^/|(^|/)\.\.(/|$))' "$ARCHIVE_LIST"; then
  die "Backup archive contains an unsafe path"
fi
tar -xzf "$BACKUP_PATH" -C "$RESTORE_TEMP"
mapfile_supported=false
if builtin help mapfile >/dev/null 2>&1; then
  mapfile_supported=true
fi
if $mapfile_supported; then
  mapfile -t BACKUP_ROOTS < <(find "$RESTORE_TEMP" -mindepth 1 -maxdepth 1 -type d)
else
  BACKUP_ROOTS=()
  while IFS= read -r path; do BACKUP_ROOTS+=("$path"); done < <(find "$RESTORE_TEMP" -mindepth 1 -maxdepth 1 -type d)
fi
[[ ${#BACKUP_ROOTS[@]} -eq 1 ]] || die "Backup archive must contain exactly one top-level directory"
BACKUP_ROOT="${BACKUP_ROOTS[0]}"
[[ -d "$BACKUP_ROOT/runtime" ]] || die "Backup is missing runtime data"
[[ -f "$BACKUP_ROOT/metadata/manifest.txt" ]] || die "Backup is missing its manifest"
BACKUP_MODE="$(grep '^backup_mode=' "$BACKUP_ROOT/metadata/manifest.txt" | head -1 | cut -d= -f2- || true)"
[[ -n "$BACKUP_MODE" ]] || BACKUP_MODE="full"
[[ "$BACKUP_MODE" == "upgrade" || "$BACKUP_MODE" == "full" ]] || die "Unknown backup mode: $BACKUP_MODE"

printf '\nBackup manifest:\n'
cat "$BACKUP_ROOT/metadata/manifest.txt"
printf '\nRestore target: %s\n' "$PROJECT_ROOT"
printf 'Restore code:   %s\n' "$RESTORE_CODE"
printf 'Run rebuild:    %s\n' "$([[ "$SKIP_BUILD" == true ]] && printf 'false' || printf 'true')"

if ! $ASSUME_YES; then
  printf '\nThis will replace the current Vito runtime data. Continue? [y/N] '
  read -r confirmation
  [[ "$confirmation" == "y" || "$confirmation" == "Y" ]] || die "Restore cancelled"
fi

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

TIMESTAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
PRE_RESTORE_BACKUP_DIR="${VITO_BACKUP_DIR:-$HOME/vito-backups}/pre-restore-$TIMESTAMP"
PRE_RESTORE_ARGS=(--leave-stopped --output "$PRE_RESTORE_BACKUP_DIR")
if [[ "$BACKUP_MODE" == "full" ]]; then
  PRE_RESTORE_ARGS=(--full "${PRE_RESTORE_ARGS[@]}")
fi
log "Creating a $BACKUP_MODE pre-restore backup"
"$SCRIPT_DIR/backup-vito.sh" "${PRE_RESTORE_ARGS[@]}"
SERVICE_STOPPED=$WAS_RUNNING
printf 'Pre-restore backup directory:\n  %s\n' "$PRE_RESTORE_BACKUP_DIR"

SAFETY_DIR="$HOME/vito-restore-safety/$TIMESTAMP"
[[ ! -e "$SAFETY_DIR" ]] || die "Safety directory already exists: $SAFETY_DIR"
mkdir -p "$SAFETY_DIR/runtime" "$SAFETY_DIR/home/.pi/agent"
chmod 700 "$HOME/vito-restore-safety" "$SAFETY_DIR"

if [[ "$BACKUP_MODE" == "upgrade" ]]; then
  log "Moving runtime entries replaced by the upgrade backup to $SAFETY_DIR/runtime"
  while IFS= read -r -d '' backup_path; do
    entry_name="$(basename "$backup_path")"
    current_path="$PROJECT_ROOT/$entry_name"
    if [[ -e "$current_path" || -L "$current_path" ]]; then
      mv "$current_path" "$SAFETY_DIR/runtime/"
    fi
  done < <(find "$BACKUP_ROOT/runtime" -mindepth 1 -maxdepth 1 ! -name user ! -name system -print0)

  mkdir -p "$SAFETY_DIR/runtime/user"
  if [[ -d "$BACKUP_ROOT/runtime/user" ]]; then
    mkdir -p "$PROJECT_ROOT/user"
    while IFS= read -r -d '' backup_path; do
      entry_name="$(basename "$backup_path")"
      current_path="$PROJECT_ROOT/user/$entry_name"
      if [[ -e "$current_path" || -L "$current_path" ]]; then
        mv "$current_path" "$SAFETY_DIR/runtime/user/"
      fi
    done < <(find "$BACKUP_ROOT/runtime/user" -mindepth 1 -maxdepth 1 -print0)
  fi
else
  log "Moving current runtime files to $SAFETY_DIR/runtime"
  for relative_path in user data logs .env vito.log; do
    current_path="$PROJECT_ROOT/$relative_path"
    if [[ -e "$current_path" || -L "$current_path" ]]; then
      mv "$current_path" "$SAFETY_DIR/runtime/"
    fi
  done
fi

# System-owned skills come from the checked-out code. Restore only the policy
# files actually present in the archive so a config rollback cannot downgrade
# bundled skills independently of code.
if [[ -d "$BACKUP_ROOT/runtime/system" ]]; then
  mkdir -p "$SAFETY_DIR/runtime/system" "$PROJECT_ROOT/system"
  while IFS= read -r -d '' backup_path; do
    entry_name="$(basename "$backup_path")"
    current_path="$PROJECT_ROOT/system/$entry_name"
    if [[ -e "$current_path" || -L "$current_path" ]]; then
      mv "$current_path" "$SAFETY_DIR/runtime/system/"
    fi
  done < <(find "$BACKUP_ROOT/runtime/system" -mindepth 1 -maxdepth 1 -print0)
fi

# Legacy archives stored the same policy file at the project root.
if [[ -f "$BACKUP_ROOT/runtime/SYSTEM.md" && ! -f "$BACKUP_ROOT/runtime/system/SYSTEM.md" ]]; then
  mkdir -p "$SAFETY_DIR/runtime/system" "$PROJECT_ROOT/system"
  if [[ -f "$PROJECT_ROOT/system/SYSTEM.md" ]]; then
    mv "$PROJECT_ROOT/system/SYSTEM.md" "$SAFETY_DIR/runtime/system/SYSTEM.md"
  fi
fi

CURRENT_PI_AUTH="$HOME/.pi/agent/auth.json"
if [[ -f "$CURRENT_PI_AUTH" ]]; then
  cp -a "$CURRENT_PI_AUTH" "$SAFETY_DIR/home/.pi/agent/auth.json"
fi

log "Restoring runtime files"
cp -a "$BACKUP_ROOT/runtime/." "$PROJECT_ROOT/"

# Archives created before system-owned assets were grouped stored SYSTEM.md at
# the project root. Preserve that policy content at its current location.
if [[ -f "$PROJECT_ROOT/SYSTEM.md" && ! -f "$BACKUP_ROOT/runtime/system/SYSTEM.md" ]]; then
  mkdir -p "$PROJECT_ROOT/system"
  mv "$PROJECT_ROOT/SYSTEM.md" "$PROJECT_ROOT/system/SYSTEM.md"
fi

BACKUP_PI_AUTH="$BACKUP_ROOT/home/.pi/agent/auth.json"
if [[ -f "$BACKUP_PI_AUTH" ]]; then
  mkdir -p "$HOME/.pi/agent"
  cp -a "$BACKUP_PI_AUTH" "$CURRENT_PI_AUTH"
  chmod 600 "$CURRENT_PI_AUTH"
fi

if $RESTORE_CODE; then
  [[ -f "$BACKUP_ROOT/repository/repository.bundle" ]] || die "Backup has no Git bundle"
  [[ -f "$BACKUP_ROOT/repository/working-tree.tar.gz" ]] || die "Backup has no working-tree snapshot"
  BACKUP_GIT_SHA="$(grep '^git_sha=' "$BACKUP_ROOT/metadata/manifest.txt" | head -1 | cut -d= -f2-)"
  [[ -n "$BACKUP_GIT_SHA" && "$BACKUP_GIT_SHA" != "no-git" ]] || die "Backup has no restorable Git commit"

  log "Restoring repository commit $BACKUP_GIT_SHA"
  git -C "$PROJECT_ROOT" bundle verify "$BACKUP_ROOT/repository/repository.bundle" >/dev/null
  BACKUP_GIT_REF="$(git bundle list-heads "$BACKUP_ROOT/repository/repository.bundle" | awk -v sha="$BACKUP_GIT_SHA" '$1 == sha { print $2; exit }')"
  [[ -n "$BACKUP_GIT_REF" ]] || die "Backup commit is not advertised by the Git bundle"
  git -C "$PROJECT_ROOT" fetch "$BACKUP_ROOT/repository/repository.bundle" "$BACKUP_GIT_REF"
  git -C "$PROJECT_ROOT" reset --hard "$BACKUP_GIT_SHA"
  git -C "$PROJECT_ROOT" clean -fd -e backups/

  CODE_TEMP="$RESTORE_TEMP/code"
  mkdir -p "$CODE_TEMP"
  tar -xzf "$BACKUP_ROOT/repository/working-tree.tar.gz" -C "$CODE_TEMP"
  if $mapfile_supported; then
    mapfile -t CODE_ROOTS < <(find "$CODE_TEMP" -mindepth 1 -maxdepth 1 -type d)
  else
    CODE_ROOTS=()
    while IFS= read -r path; do CODE_ROOTS+=("$path"); done < <(find "$CODE_TEMP" -mindepth 1 -maxdepth 1 -type d)
  fi
  [[ ${#CODE_ROOTS[@]} -eq 1 ]] || die "Working-tree snapshot has an invalid layout"
  cp -a "${CODE_ROOTS[0]}/." "$PROJECT_ROOT/"
fi

if ! $SKIP_BUILD; then
  log "Installing backend dependencies"
  (cd "$PROJECT_ROOT" && npm ci)

  log "Installing dashboard dependencies"
  (cd "$PROJECT_ROOT" && npm --prefix dashboard ci)

  if [[ -f "$PROJECT_ROOT/src/cli/validate-config.ts" && -f "$PROJECT_ROOT/user/vito.config.json" ]]; then
    log "Validating restored configuration"
    (cd "$PROJECT_ROOT" && npm run validate:config -- user/vito.config.json)
  fi

  log "Building backend"
  (cd "$PROJECT_ROOT" && npm run build)

  log "Building dashboard"
  (cd "$PROJECT_ROOT" && npm run build:dashboard)
fi

if $WAS_RUNNING; then
  command -v pm2 >/dev/null 2>&1 || die "PM2 is required to restore the previous running state"
  log "Restarting $SERVICE_NAME"
  if pm2 describe "$SERVICE_NAME" >/dev/null 2>&1; then
    pm2 restart "$SERVICE_NAME" --update-env
  else
    (cd "$PROJECT_ROOT" && pm2 start user/ecosystem.config.cjs)
  fi
else
  log "$SERVICE_NAME was not running before restore; leaving it stopped"
fi

printf '\nRestore complete.\n'
printf 'Pre-restore archive: %s\n' "$PRE_RESTORE_BACKUP_DIR"
printf 'Moved-aside runtime: %s\n' "$SAFETY_DIR"
printf 'Keep both safety copies until Vito has been fully verified.\n'
