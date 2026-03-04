#!/usr/bin/env bash
set -euo pipefail

# ── teardown.sh ─────────────────────────────────────────────────────
# Tear down an EC2 customer instance and all associated resources.
#
# Usage:  ./aws_deploy/teardown.sh <name> [--force]
# ────────────────────────────────────────────────────────────────────

NAME="${1:?Usage: teardown.sh <name> [--force]}"
FORCE="${2:-}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_FILE="$SCRIPT_DIR/state/$NAME.json"

log()  { echo -e "\033[1;34m→\033[0m $*"; }
ok()   { echo -e "\033[1;32m✓\033[0m $*"; }
die()  { echo -e "\033[1;31m✗\033[0m $*" >&2; exit 1; }

[ -f "$STATE_FILE" ] || die "State file not found: $STATE_FILE"

# Load state
INSTANCE_ID=$(jq -r '.instance_id' "$STATE_FILE")
ELASTIC_IP=$(jq -r '.elastic_ip' "$STATE_FILE")
ALLOCATION_ID=$(jq -r '.allocation_id' "$STATE_FILE")
SG_ID=$(jq -r '.security_group_id' "$STATE_FILE")
REGION=$(jq -r '.region' "$STATE_FILE")
DOMAIN=$(jq -r '.domain' "$STATE_FILE")
HOSTED_ZONE_ID=$(jq -r '.hosted_zone_id' "$STATE_FILE")

echo "About to tear down instance for: $NAME"
echo "  Instance:  $INSTANCE_ID"
echo "  IP:        $ELASTIC_IP"
echo "  SG:        $SG_ID"
echo "  Region:    $REGION"
echo ""

if [ "$FORCE" != "--force" ]; then
  read -p "Are you sure? Type 'yes' to confirm: " CONFIRM
  [ "$CONFIRM" = "yes" ] || die "Aborted."
fi

# ── Delete Route53 records ──────────────────────────────────────────

log "Deleting DNS records …"
aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" \
  --change-batch "{
    \"Changes\": [
      {
        \"Action\": \"DELETE\",
        \"ResourceRecordSet\": {
          \"Name\": \"${NAME}.${DOMAIN}\",
          \"Type\": \"A\",
          \"TTL\": 300,
          \"ResourceRecords\": [{\"Value\": \"$ELASTIC_IP\"}]
        }
      },
      {
        \"Action\": \"DELETE\",
        \"ResourceRecordSet\": {
          \"Name\": \"*.${NAME}.${DOMAIN}\",
          \"Type\": \"A\",
          \"TTL\": 300,
          \"ResourceRecords\": [{\"Value\": \"$ELASTIC_IP\"}]
        }
      }
    ]
  }" >/dev/null 2>&1 || log "DNS records already gone or mismatch — skipping"
ok "DNS records deleted"

# ── Terminate EC2 ───────────────────────────────────────────────────

log "Terminating instance $INSTANCE_ID …"
aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" --region "$REGION" >/dev/null
aws ec2 wait instance-terminated --instance-ids "$INSTANCE_ID" --region "$REGION"
ok "Instance terminated"

# ── Release Elastic IP ──────────────────────────────────────────────

log "Releasing Elastic IP $ELASTIC_IP ($ALLOCATION_ID) …"
aws ec2 release-address --allocation-id "$ALLOCATION_ID" --region "$REGION" >/dev/null 2>&1 || log "EIP already released"
ok "Elastic IP released"

# ── Delete security group ──────────────────────────────────────────

log "Deleting security group $SG_ID …"
# SG deletion may need a moment after instance termination
for i in $(seq 1 12); do
  if aws ec2 delete-security-group --group-id "$SG_ID" --region "$REGION" 2>/dev/null; then
    break
  fi
  [ "$i" = "12" ] && log "Could not delete SG $SG_ID — may need manual cleanup"
  sleep 10
done
ok "Security group deleted"

# ── Remove state file ──────────────────────────────────────────────

rm -f "$STATE_FILE"
ok "State file removed"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Teardown complete for: $NAME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
