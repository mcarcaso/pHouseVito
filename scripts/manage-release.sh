#!/usr/bin/env bash
set -euo pipefail

usage() { echo 'Usage: manage-release.sh <root> status|verify <version>|activate <version>|rollback' >&2; exit 2; }
[ "$#" -ge 2 ] && [ "$#" -le 3 ] || usage
ROOT="$1"; ACTION="$2"; VERSION="${3:-}"
[ -d "$ROOT/releases" ] && [ -d "$ROOT/data/user" ] || { echo 'Not a Vito installation' >&2; exit 1; }
ROOT="$(cd "$ROOT" && pwd -P)"
current() {
  if [ -L "$ROOT/current" ]; then
    local path
    path="$(realpath "$ROOT/current")"
    [ "$(dirname "$path")" = "$ROOT/releases" ] && [[ "$(basename "$path")" =~ ^vito-[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo 'Unsafe current link' >&2; exit 1; }
    [ -d "$path" ] || { echo 'Current release is missing' >&2; exit 1; }
    echo "$path"
  elif [ -e "$ROOT/current" ]; then echo 'current must be a symlink' >&2; exit 1
  fi
}
version_target() {
  [[ "$VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || usage
  local target="$ROOT/releases/vito-$VERSION"
  [ -d "$target" ] && [ ! -L "$target" ] || { echo "Release not installed: $VERSION" >&2; exit 1; }
  echo "$target"
}
verify() {
  local target="$1"
  [ -x "$target/run.sh" ] && [ -f "$target/dist/index.js" ] &&
    [ -f "$target/mobile/dist/index.html" ] && [ -d "$target/system/skills" ] &&
    [ -f "$target/node_modules/better-sqlite3/build/Release/better_sqlite3.node" ] &&
    [ -L "$target/user" ] && [ "$(realpath "$target/user")" = "$ROOT/data/user" ] || {
    echo "Invalid release layout: $target" >&2; exit 1;
  }
  (cd "$target" && node --input-type=module -e '
    import { createRequire } from "node:module";
    const require = createRequire(import.meta.url);
    new (require("better-sqlite3"))(":memory:").close();
    await import("./dist/shared/schemas/vito-config.js");
  ')
}
switch_to() {
  local target="$1" previous
  previous="$(current)"
  [ "$previous" != "$target" ] || { echo 'Already active'; return; }
  local next="$ROOT/.current-next-$$" prior="$ROOT/.previous-next-$$"
  trap 'rm -f "$next" "$prior"' EXIT
  ln -s "$target" "$next"
  if [ -n "$previous" ]; then
    ln -s "$previous" "$prior"
    # Rename on the same filesystem; replacing a symlink never touches its target.
    node -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' "$prior" "$ROOT/previous"
  fi
  node -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' "$next" "$ROOT/current"
  trap - EXIT
  echo "Active for next service start: $target"
  echo 'No process restarted. Health checks and service cutover remain operator-controlled.'
}
case "$ACTION" in
  status)
    [ -z "$VERSION" ] || usage
    echo "current: $(current)"
    if [ -L "$ROOT/previous" ]; then echo "previous: $(readlink "$ROOT/previous")"; fi
    ;;
  verify) [ -n "$VERSION" ] || usage; verify "$(version_target)"; echo "Verified: $VERSION" ;;
  activate) [ -n "$VERSION" ] || usage; target="$(version_target)"; verify "$target"; switch_to "$target" ;;
  rollback)
    [ -z "$VERSION" ] || usage
    [ -L "$ROOT/previous" ] || { echo 'No previous release' >&2; exit 1; }
    target="$(realpath "$ROOT/previous")"
    [ "$(dirname "$target")" = "$ROOT/releases" ] && [[ "$(basename "$target")" =~ ^vito-[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo 'Unsafe previous link' >&2; exit 1; }
    VERSION="${target##*/vito-}"
    [ "$target" = "$(version_target)" ] || exit 1
    verify "$target"
    switch_to "$target"
    ;;
  *) usage ;;
esac
