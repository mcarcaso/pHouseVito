#!/usr/bin/env bash
set -euo pipefail

# Deploy a prebuilt immutable installer to an existing managed Vito instance.
# The installer must be built on the target OS/architecture and contain the
# exact requested Git revision.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
KEY_PATH="$HOME/.ssh/vito-deploy.pem"
ARTIFACT_DIR="${VITO_ARTIFACT_DIR:-$PROJECT_ROOT/.releases}"
VERSION=""
LEGACY_SOURCE=false
NAME=""

usage() {
  cat <<'EOF'
Usage: aws_deploy/deploy.sh <name> [options]

Options:
  --version VERSION     Artifact version (default: short local Git revision)
  --artifact-dir DIR    Directory containing prebuilt installers
  --legacy-source       Use the old pull/build-in-place deployment
  -h, --help            Show this help

Expected installer name:
  vito-<version>-linux-<arm64|x64>-installer

The installer must have an adjacent .sha256 file. Managed deployments are
installed under /opt/vito-managed. Source deployments require either the
one-time migration workflow or the explicit --legacy-source fallback.
EOF
}

log() { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

while (($# > 0)); do
  case "$1" in
    --version)
      (($# >= 2)) || die "--version requires a value"
      VERSION="$2"
      shift 2
      ;;
    --artifact-dir)
      (($# >= 2)) || die "--artifact-dir requires a directory"
      ARTIFACT_DIR="$2"
      shift 2
      ;;
    --legacy-source)
      LEGACY_SOURCE=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*) die "Unknown option: $1" ;;
    *)
      [ -z "$NAME" ] || die "Only one deployment name may be supplied"
      NAME="$1"
      shift
      ;;
  esac
done

[ -n "$NAME" ] || { usage >&2; exit 2; }
STATE_FILE="$SCRIPT_DIR/state/$NAME.json"
[ -f "$STATE_FILE" ] || die "State file not found: $STATE_FILE"
[ -f "$KEY_PATH" ] || die "SSH key not found: $KEY_PATH"

ELASTIC_IP="$(jq -er '.elastic_ip' "$STATE_FILE")"
DOMAIN="$(jq -er '.domain' "$STATE_FILE")"
PUBLIC_URL="https://${NAME}.${DOMAIN}/"
SSH_ARGS=(
  -i "$KEY_PATH"
  -o BatchMode=yes
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o LogLevel=ERROR
)

if $LEGACY_SOURCE; then
  exec "$SCRIPT_DIR/deploy-source.sh" "$NAME"
fi

[ -n "$VERSION" ] || VERSION="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD)"
[[ "$VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "Invalid version: $VERSION"
EXPECTED_REVISION="$(git -C "$PROJECT_ROOT" rev-parse HEAD)"
ARTIFACT_DIR="$(cd "$ARTIFACT_DIR" 2>/dev/null && pwd)" || die "Artifact directory not found: $ARTIFACT_DIR"

log "Inspecting $NAME ($ELASTIC_IP)"
REMOTE_INFO="$(ssh "${SSH_ARGS[@]}" "ubuntu@$ELASTIC_IP" 'bash -s' <<'REMOTE'
set -euo pipefail
kernel="$(uname -s)"
machine="$(uname -m)"
node_version="$(node -p 'process.versions.node' 2>/dev/null || true)"
managed=false
if [ -d /opt/vito-managed/releases ] && [ -d /opt/vito-managed/data/user ]; then managed=true; fi
printf '%s\t%s\t%s\t%s\n' "$kernel" "$machine" "$node_version" "$managed"
REMOTE
)"
IFS=$'\t' read -r REMOTE_KERNEL REMOTE_MACHINE REMOTE_NODE REMOTE_MANAGED <<< "$REMOTE_INFO"

[ "$REMOTE_KERNEL" = "Linux" ] || die "Unsupported target OS: $REMOTE_KERNEL"
case "$REMOTE_MACHINE" in
  aarch64|arm64) TARGET="linux-arm64" ;;
  x86_64|amd64) TARGET="linux-x64" ;;
  *) die "Unsupported target architecture: $REMOTE_MACHINE" ;;
esac
[ -n "$REMOTE_NODE" ] || die "Node.js is not installed on the target"
NODE_MAJOR="${REMOTE_NODE%%.*}"
NODE_REST="${REMOTE_NODE#*.}"
NODE_MINOR="${NODE_REST%%.*}"
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 19 ]; }; then
  die "Target requires Node >=22.19; found $REMOTE_NODE"
fi
[ "$REMOTE_MANAGED" = true ] || die \
  "$NAME is not a managed deployment; migrate it once or use --legacy-source"

INSTALLER_NAME="vito-${VERSION}-${TARGET}-installer"
INSTALLER="$ARTIFACT_DIR/$INSTALLER_NAME"
CHECKSUM="$INSTALLER.sha256"
log "Target: $TARGET, Node $REMOTE_NODE; artifact: $INSTALLER_NAME"
[ -f "$INSTALLER" ] || die "Installer not found: $INSTALLER"
[ -f "$CHECKSUM" ] || die "Checksum not found: $CHECKSUM"
(cd "$ARTIFACT_DIR" && shasum -a 256 -c "$(basename "$CHECKSUM")") >/dev/null || \
  die "Local installer checksum failed"

REMOTE_STAGE="/home/ubuntu/vito-deploy/${VERSION}-${TARGET}"
ssh "${SSH_ARGS[@]}" "ubuntu@$ELASTIC_IP" \
  "mkdir -p '$REMOTE_STAGE' && chmod 700 '$REMOTE_STAGE'"
scp -q "${SSH_ARGS[@]}" "$INSTALLER" "$CHECKSUM" \
  "ubuntu@$ELASTIC_IP:$REMOTE_STAGE/"

log "Installing and activating $VERSION"
ssh "${SSH_ARGS[@]}" "ubuntu@$ELASTIC_IP" bash -s -- \
  "$REMOTE_STAGE" "$INSTALLER_NAME" "$VERSION" "$EXPECTED_REVISION" "$PUBLIC_URL" <<'REMOTE'
set -euo pipefail
stage="$1"
installer_name="$2"
version="$3"
expected_revision="$4"
public_url="$5"
installer="$stage/$installer_name"
root=/opt/vito-managed
service=vito-server
backup_root="$HOME/vito-backups/managed-deploys"

cleanup() { rm -rf "$stage"; }
trap cleanup EXIT

cd "$stage"
shasum -a 256 -c "$installer_name.sha256"
chmod 700 "$installer"
"$installer" doctor

if [ ! -d "$root/releases/vito-$version" ]; then
  sudo "$installer" install "$root"
else
  sudo "$installer" verify "$root" "$version"
fi

actual_revision="$(sed -n 's/^Revision: //p' "$root/releases/vito-$version/RELEASE_INFO")"
[ "$actual_revision" = "$expected_revision" ] || {
  echo "Artifact revision mismatch: expected $expected_revision, found $actual_revision" >&2
  exit 1
}
grep -qx 'Dirty: 0' "$root/releases/vito-$version/RELEASE_INFO" || {
  echo 'Refusing a dirty release artifact' >&2
  exit 1
}

# This compact backup is intentionally independent of source-checkout scripts.
# SQLite's online backup is consistent under WAL while keeping downtime short.
timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
backup="$backup_root/$timestamp-$version"
mkdir -p "$backup"
chmod 700 "$backup_root" "$backup"
for database in vito.db embeddings.db; do
  source="$root/data/user/$database"
  if [ -f "$source" ]; then sqlite3 "$source" ".backup '$backup/$database'"; fi
done
for file in vito.config.json secrets.json SOUL.md profile.md profile.json; do
  source="$root/data/user/$file"
  if [ -f "$source" ]; then cp -a "$source" "$backup/"; fi
done
printf '%s\n' "version=$version" "revision=$expected_revision" > "$backup/DEPLOY_INFO"
chmod -R go-rwx "$backup"

sudo "$installer" activate "$root" "$version"
pm2 restart "$service" --update-env >/dev/null

healthy=false
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:3030/; then healthy=true; break; fi
  sleep 1
done
if $healthy && ! curl -fsS -o /dev/null "$public_url"; then healthy=false; fi
if $healthy && ! sqlite3 -readonly "$root/data/user/vito.db" 'PRAGMA quick_check;' | grep -qx ok; then
  healthy=false
fi
if $healthy && ! "$root/current/vito" config validate "$root/data/user/vito.config.json" >/dev/null; then
  healthy=false
fi

if ! $healthy; then
  echo 'New release failed health checks; rolling back' >&2
  sudo "$installer" rollback "$root"
  pm2 restart "$service" --update-env >/dev/null || true
  for _ in $(seq 1 30); do
    curl -fsS -o /dev/null http://127.0.0.1:3030/ && break
    sleep 1
  done
  exit 1
fi

pm2 save >/dev/null
printf 'release=%s\nrevision=%s\nbackup=%s\n' "$version" "$actual_revision" "$backup"
REMOTE

ok "Deployed $VERSION to $NAME ($TARGET)"
