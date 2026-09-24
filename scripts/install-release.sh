#!/usr/bin/env bash
set -euo pipefail

# Usage: install-release.sh <archive> <install-root> [--activate]
# Installs an immutable Node bundle with persistent user data outside the bundle.
# No service restart is performed. Activate only after verifying the release.
[ "$#" -ge 2 ] && [ "$#" -le 3 ] || { echo 'Usage: install-release.sh <archive> <install-root> [--activate]' >&2; exit 2; }
ARCHIVE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
ROOT="$2"
ACTIVATE="${3:-}"
[ -z "$ACTIVATE" ] || [ "$ACTIVATE" = '--activate' ] || exit 2
[ -f "$ARCHIVE" ] && [ -f "$ARCHIVE.sha256" ] || { echo 'Archive and checksum required' >&2; exit 1; }
(cd "$(dirname "$ARCHIVE")" && shasum -a 256 -c "$(basename "$ARCHIVE").sha256")
FILENAME="$(basename "$ARCHIVE")"
[[ "$FILENAME" =~ ^vito-([A-Za-z0-9][A-Za-z0-9._-]*)-(darwin|linux)-(x64|arm64)\.tar\.gz$ ]] || { echo 'Invalid archive name' >&2; exit 2; }
NAME="${BASH_REMATCH[1]}"
PLATFORM="${BASH_REMATCH[2]}-${BASH_REMATCH[3]}"
[ "$PLATFORM" = "$(node -p 'process.platform + "-" + process.arch')" ] || { echo "Wrong platform: $PLATFORM" >&2; exit 1; }
ENTRY="vito-$NAME"
# The checksum catches corruption, not a maliciously replaced artifact.
# Inspect every archive member and link before tar can touch the filesystem.
python3 "$(cd "$(dirname "$0")" && pwd)/validate-release-archive.py" "$ARCHIVE" "$ENTRY"
ROOT="$(mkdir -p "$ROOT" && cd "$ROOT" && pwd)"
mkdir -p "$ROOT/releases" "$ROOT/data"
TARGET="$ROOT/releases/$ENTRY"
[ ! -e "$TARGET" ] && [ ! -L "$TARGET" ] || { echo "Release already installed: $TARGET" >&2; exit 1; }
LOCK="$ROOT/.install-lock"
mkdir "$LOCK" 2>/dev/null || { echo 'Another install is running (or stale lock exists)' >&2; exit 1; }
TMP=""
trap 'if [ -n "$TMP" ]; then rm -rf "$TMP"; fi; rmdir "$LOCK"' EXIT
TMP="$(mktemp -d "$ROOT/releases/.install.XXXXXXXX")"
tar -xzf "$ARCHIVE" -C "$TMP" --no-same-owner
[ -d "$TMP/$ENTRY/dist" ] && [ -d "$TMP/$ENTRY/system/skills" ] || exit 1
NODE_VERSION="$(sed -n 's/^Node: v//p' "$TMP/$ENTRY/RELEASE_INFO" | head -1)"
[ -n "$NODE_VERSION" ] && [ "${NODE_VERSION%%.*}" = "$(node -p 'process.versions.node.split(".")[0]')" ] || { echo 'Node major version mismatch' >&2; exit 1; }
[ ! -L "$ROOT/data/user" ] || { echo 'data/user cannot be a symlink' >&2; exit 1; }
if [ ! -e "$ROOT/data/user" ]; then
  USER_TMP="$(mktemp -d "$ROOT/data/.user-new.XXXXXXXX")"
  cp -R "$TMP/$ENTRY/user.example/." "$USER_TMP/"
  chmod 700 "$USER_TMP"
  mv "$USER_TMP" "$ROOT/data/user"
fi
[ -d "$ROOT/data/user" ] || { echo 'data/user must be a directory' >&2; exit 1; }
ln -s "$ROOT/data/user" "$TMP/$ENTRY/user"
# Protect release files from accidental edits. Real enforcement on client VMs
# requires a separate release-owning OS user; chmod by the owner is reversible.
find "$TMP/$ENTRY" -type f -exec chmod a-w {} +
mv "$TMP/$ENTRY" "$TARGET"
"$(cd "$(dirname "$0")" && pwd)/manage-release.sh" "$ROOT" verify "$NAME"
if [ "$ACTIVATE" = '--activate' ]; then
  "$(cd "$(dirname "$0")" && pwd)/manage-release.sh" "$ROOT" activate "$NAME"
fi
echo "Installed: $TARGET"
echo "Data: $ROOT/data/user"
echo "Run from release directory: cd $TARGET && ./run.sh"
echo 'No process was restarted.'
