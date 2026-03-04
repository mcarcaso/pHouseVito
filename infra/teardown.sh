#!/bin/bash
set -e

# ============================================================================
# CLOUDMALLINC INFRASTRUCTURE TEARDOWN
# ============================================================================
# Tears down all resources created by spinup.sh
# Usage: ./teardown.sh [--force]
# ============================================================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

FORCE=false
STATE_FILE="$(dirname "$0")/cloudmallinc-state.json"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --force) FORCE=true; shift ;;
        --state) STATE_FILE="$2"; shift 2 ;;
        *) error "Unknown option: $1" ;;
    esac
done

# ============================================================================
# LOAD STATE
# ============================================================================

if [ ! -f "$STATE_FILE" ]; then
    error "State file not found: $STATE_FILE"
fi

log "Loading state from $STATE_FILE..."

INSTANCE_ID=$(jq -r '.instance_id' "$STATE_FILE")
ELASTIC_IP=$(jq -r '.elastic_ip' "$STATE_FILE")
ALLOCATION_ID=$(jq -r '.allocation_id' "$STATE_FILE")
SECURITY_GROUP_ID=$(jq -r '.security_group_id' "$STATE_FILE")
KEY_NAME=$(jq -r '.key_name' "$STATE_FILE")
REGION=$(jq -r '.region' "$STATE_FILE")
DOMAIN=$(jq -r '.domain' "$STATE_FILE")
HOSTED_ZONE_ID=$(jq -r '.hosted_zone_id' "$STATE_FILE")

echo ""
echo "============================================================================"
echo -e "${YELLOW}RESOURCES TO BE DESTROYED${NC}"
echo "============================================================================"
echo ""
echo "  Instance:       $INSTANCE_ID"
echo "  Elastic IP:     $ELASTIC_IP ($ALLOCATION_ID)"
echo "  Security Group: $SECURITY_GROUP_ID"
echo "  DNS Records:    *.${DOMAIN}, ${DOMAIN}"
echo "  Region:         $REGION"
echo ""
echo "============================================================================"

if [ "$FORCE" != true ]; then
    read -p "Are you sure you want to destroy all resources? (yes/no): " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
        echo "Aborted."
        exit 0
    fi
fi

# ============================================================================
# REMOVE DNS RECORDS
# ============================================================================

log "Removing Route 53 DNS records..."

# Remove wildcard record
aws route53 change-resource-record-sets \
    --hosted-zone-id "$HOSTED_ZONE_ID" \
    --change-batch '{
        "Changes": [{
            "Action": "DELETE",
            "ResourceRecordSet": {
                "Name": "*.'"$DOMAIN"'",
                "Type": "A",
                "TTL": 300,
                "ResourceRecords": [{"Value": "'"$ELASTIC_IP"'"}]
            }
        }]
    }' 2>/dev/null || warn "Could not delete wildcard DNS record (may not exist)"

# Remove root domain record
aws route53 change-resource-record-sets \
    --hosted-zone-id "$HOSTED_ZONE_ID" \
    --change-batch '{
        "Changes": [{
            "Action": "DELETE",
            "ResourceRecordSet": {
                "Name": "'"$DOMAIN"'",
                "Type": "A",
                "TTL": 300,
                "ResourceRecords": [{"Value": "'"$ELASTIC_IP"'"}]
            }
        }]
    }' 2>/dev/null || warn "Could not delete root DNS record (may not exist)"

log "DNS records removed"

# ============================================================================
# TERMINATE EC2 INSTANCE
# ============================================================================

log "Terminating EC2 instance: $INSTANCE_ID..."

aws ec2 terminate-instances \
    --instance-ids "$INSTANCE_ID" \
    --region "$REGION" > /dev/null

log "Waiting for instance to terminate..."
aws ec2 wait instance-terminated \
    --instance-ids "$INSTANCE_ID" \
    --region "$REGION"

log "Instance terminated"

# ============================================================================
# RELEASE ELASTIC IP
# ============================================================================

log "Releasing Elastic IP: $ELASTIC_IP..."

aws ec2 release-address \
    --allocation-id "$ALLOCATION_ID" \
    --region "$REGION" 2>/dev/null || warn "Could not release Elastic IP (may already be released)"

log "Elastic IP released"

# ============================================================================
# DELETE SECURITY GROUP
# ============================================================================

log "Deleting security group: $SECURITY_GROUP_ID..."

# Security groups can take a moment to be deletable after instance termination
sleep 5

aws ec2 delete-security-group \
    --group-id "$SECURITY_GROUP_ID" \
    --region "$REGION" 2>/dev/null || warn "Could not delete security group (may have dependencies or not exist)"

log "Security group deleted"

# ============================================================================
# CLEANUP KEY PAIR (optional)
# ============================================================================

read -p "Delete SSH key pair '$KEY_NAME'? (yes/no): " DELETE_KEY
if [ "$DELETE_KEY" == "yes" ]; then
    aws ec2 delete-key-pair \
        --key-name "$KEY_NAME" \
        --region "$REGION" 2>/dev/null || warn "Could not delete key pair"
    
    if [ -f ~/.ssh/${KEY_NAME}.pem ]; then
        rm ~/.ssh/${KEY_NAME}.pem
        log "Local key file deleted: ~/.ssh/${KEY_NAME}.pem"
    fi
    
    log "Key pair deleted"
else
    warn "Key pair '$KEY_NAME' retained"
fi

# ============================================================================
# REMOVE STATE FILE
# ============================================================================

rm "$STATE_FILE"
log "State file removed"

# ============================================================================
# DONE
# ============================================================================

echo ""
echo "============================================================================"
echo -e "${GREEN}TEARDOWN COMPLETE${NC}"
echo "============================================================================"
echo ""
echo "  All resources have been destroyed."
echo ""
echo "============================================================================"
