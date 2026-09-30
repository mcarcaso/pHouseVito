#!/usr/bin/env bash
set -euo pipefail

# Build an offline, versioned Node release. Run on the same OS/architecture and
# compatible Node ABI as the target: better-sqlite3 contains native code.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-$(git -C "$ROOT" rev-parse --short HEAD)}"
[[ "$VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo 'Invalid release version' >&2; exit 2; }
OUT="${2:-$ROOT/.releases}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/vito-release.XXXXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
RELEASE="$STAGE/vito-$VERSION"
SOURCE="$STAGE/source"
mkdir -p "$RELEASE/scripts" "$RELEASE/mobile"

if [ -n "$(git -C "$ROOT" status --porcelain -- src mobile system scripts packages/vito-client package.json package-lock.json tsconfig.json user.example)" ] && [ "${ALLOW_DIRTY_RELEASE:-}" != 1 ]; then
  echo 'Source is dirty. Commit first, or explicitly set ALLOW_DIRTY_RELEASE=1 for a local-only pilot.' >&2
  exit 1
fi
node "$ROOT/scripts/copy-release-source.mjs" "$ROOT" "$SOURCE"
# Build inside an isolated snapshot; never remove the live mobile/dist.
(cd "$SOURCE" && npm ci --include=dev && npm --prefix mobile ci --include=dev && npm run build && npm run build:mobile:web)
cp "$SOURCE/package.json" "$SOURCE/package-lock.json" "$RELEASE/"
cp "$SOURCE/scripts/patch-croner-timeout.mjs" "$RELEASE/scripts/"
cp "$SOURCE/scripts/provision-update-service.sh" "$RELEASE/scripts/"
cp "$SOURCE/scripts/release-run.sh" "$RELEASE/run.sh"
cp "$SOURCE/scripts/release-vito.sh" "$RELEASE/vito"
chmod +x "$RELEASE/run.sh" "$RELEASE/vito"
cp -R "$SOURCE/dist" "$SOURCE/system" "$SOURCE/user.example" "$RELEASE/"
mkdir -p "$RELEASE/docs"
cp "$SOURCE/docs/signed-updates.md" "$RELEASE/docs/"
cp -R "$SOURCE/mobile/dist" "$RELEASE/mobile/"
# package.json's postinstall patches Croner. Staging is outside the source tree.
(cd "$RELEASE" && npm ci --omit=dev)
# Never capture mutable user data or credentials in a release artifact.
test ! -e "$RELEASE/user"
test -f "$RELEASE/system/skills/mcp-client/mcp-client.mjs"
test -f "$RELEASE/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
node --input-type=module -e 'import("file://" + process.argv[1] + "/dist/shared/schemas/vito-config.js").then(() => console.log("Release import OK"))' "$RELEASE"
printf '%s\n' "Node: $(node --version)" "Platform: $(node -p 'process.platform + "/" + process.arch')" "Revision: $(git -C "$ROOT" rev-parse HEAD)" "Dirty: ${ALLOW_DIRTY_RELEASE:-0}" > "$RELEASE/RELEASE_INFO"
# Refuse overwrites: a version name always refers to the same bits.
ARCHIVE="$OUT/vito-$VERSION-$(node -p 'process.platform + "-" + process.arch').tar.gz"
[ ! -e "$ARCHIVE" ] || { echo "Release already exists: $ARCHIVE" >&2; exit 1; }
(cd "$STAGE" && tar -czf "$ARCHIVE" "vito-$VERSION")
(cd "$OUT" && shasum -a 256 "$(basename "$ARCHIVE")") > "$ARCHIVE.sha256"
echo "Release: $ARCHIVE"
cat "$ARCHIVE.sha256"
