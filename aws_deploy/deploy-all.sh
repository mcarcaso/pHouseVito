#!/usr/bin/env bash
set -euo pipefail
# Deploy selected clients, or all local deployment states, sequentially; stop on failure.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "${1:-}" == --help || "${1:-}" == -h ]]; then
  echo 'Usage: aws_deploy/deploy-all.sh [name ...] (no names: all local deployment states)'
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
echo "Deploying sequentially: $*"
for name in "$@"; do
  "$SCRIPT_DIR/deploy.sh" "$name"
done
