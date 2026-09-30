#!/usr/bin/env bash
set -euo pipefail
# Explicit operator-only provisioning. Does not stop/restart/register a service.
[ "$#" -eq 2 ] || { echo 'Usage: provision-update-service.sh INSTALL_ROOT HEALTH_PORT'; exit 2; }
ROOT="$(cd "$1" && pwd -P)"
PORT="$2"
[[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || exit 2
[ -L "$ROOT/current" ] && [ -d "$ROOT/data/user" ] && [ -d "$ROOT/releases" ] || { echo 'Not a managed installation'; exit 1; }
[ ! -e "$ROOT/update-service.json" ] && [ ! -e "$ROOT/run-current.sh" ] || { echo 'Provisioning files already exist; review them manually'; exit 1; }
umask 077
cat > "$ROOT/run-current.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd -P)"
TARGET="$(realpath "$ROOT/current")"
[ "$(dirname "$TARGET")" = "$ROOT/releases" ] || { echo 'Unsafe release link'; exit 1; }
cd "$TARGET"
exec ./run.sh
SH
chmod 700 "$ROOT/run-current.sh"
printf '{"schema":1,"service":"vito-server","healthUrl":"http://127.0.0.1:%s/api/health"}\n' "$PORT" > "$ROOT/update-service.json"
echo 'Provisioned files only. As the Vito service owner, explicitly reconfigure PM2 to run INSTALL_ROOT/run-current.sh with bash, then verify health and pm2 save.'
echo 'The service user must have installation-directory write permission. Privilege-separated/root-owned installs need an operator-controlled supervisor; do not grant blanket sudo.'
