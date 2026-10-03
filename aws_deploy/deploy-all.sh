#!/usr/bin/env bash
set -euo pipefail
# Deploy selected clients, or all local deployment states, in parallel.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "${1:-}" == --help || "${1:-}" == -h ]]; then
  echo 'Usage: aws_deploy/deploy-all.sh [name ...] (no names: all local deployment states)'
  echo 'Runs in parallel; prints the path to a live HTML dashboard and per-instance logs.'
  exit 0
fi
if [[ $# == 0 ]]; then
  shopt -s nullglob
  states=("$SCRIPT_DIR"/state/*.json)
  [[ ${#states[@]} -gt 0 ]] || { echo 'No local deployment states found' >&2; exit 1; }
  for state in "${states[@]}"; do
    name="${state##*/}"
    set -- "$@" "${name%.json}"
  done
  echo "Deploy to all local instances: $*"
  read -r -p 'Type yes to proceed: ' confirmation || confirmation=""
  if [[ "$confirmation" != yes ]]; then
    echo 'Deployment cancelled.'
    exit 0
  fi
fi
# Validate and deduplicate before starting any deployment.
names=()
for name in "$@"; do
  [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || { echo "Invalid instance name: $name" >&2; exit 2; }
  duplicate=false
  if [[ ${#names[@]} -gt 0 ]]; then
    for existing in "${names[@]}"; do
      [[ "$existing" != "$name" ]] || duplicate=true
    done
  fi
  [[ "$duplicate" == true ]] || names+=("$name")
done

echo "Deploying in parallel: ${names[*]}"
command -v node >/dev/null || { echo 'Node.js is required for the deployment dashboard' >&2; exit 1; }
mkdir -p "$SCRIPT_DIR/state/deploy-logs"
LOG_DIR="$(mktemp -d "$SCRIPT_DIR/state/deploy-logs/run-$(date +%Y%m%d-%H%M%S).XXXXXX")"
chmod 700 "$LOG_DIR"
touch "$LOG_DIR/.running"
for name in "${names[@]}"; do
  touch "$LOG_DIR/$name.log"
  echo running > "$LOG_DIR/$name.status"
done
node "$SCRIPT_DIR/deploy-dashboard.mjs" "$LOG_DIR" "${names[@]}" &
DASHBOARD_PID=$!
trap 'rm -f "$LOG_DIR/.running"; wait "$DASHBOARD_PID" || true' EXIT
echo "Live dashboard: $LOG_DIR/index.html"
echo "Instance logs:  $LOG_DIR/<name>.log"
pids=()
for name in "${names[@]}"; do
  (
    if "$SCRIPT_DIR/deploy.sh" "$name" </dev/null 2>&1 | tee "$LOG_DIR/$name.log" |
      while IFS= read -r line || [[ -n "$line" ]]; do
        printf '[%s] %s\n' "$name" "$line"
      done
    then
      echo succeeded > "$LOG_DIR/$name.status"
    else
      echo failed > "$LOG_DIR/$name.status"
      exit 1
    fi
  ) &
  pids+=("$!")
done

failed=()
for index in "${!pids[@]}"; do
  if wait "${pids[$index]}"; then
    echo succeeded > "$LOG_DIR/${names[$index]}.status"
    echo "[${names[$index]}] Deployment succeeded."
  else
    echo failed > "$LOG_DIR/${names[$index]}.status"
    failed+=("${names[$index]}")
    echo "[${names[$index]}] Deployment failed." >&2
  fi
done
rm -f "$LOG_DIR/.running"
wait "$DASHBOARD_PID"
if [[ ${#failed[@]} -gt 0 ]]; then
  echo "Failed deployments: ${failed[*]}" >&2
  exit 1
fi
echo "All deployments succeeded."
