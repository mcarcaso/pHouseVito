#!/bin/bash
set -e

# ============================================================================
# Deprovision Customer (Remote Wrapper)
# 
# This script runs from YOUR machine and SSHs into the EC2 to deprovision.
#
# Usage: ./deprovision-customer.sh <username>
# Example: ./deprovision-customer.sh mike
# ============================================================================

CUSTOMER_NAME="$1"
DOMAIN="cloudmallinc.com"
EC2_USER="ubuntu"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ============================================================================
# Validation
# ============================================================================

if [ -z "$CUSTOMER_NAME" ]; then
    echo "Usage: ./deprovision-customer.sh <username>"
    echo "Example: ./deprovision-customer.sh mike"
    exit 1
fi

# Load state file
STATE_FILE="$(dirname "$0")/cloudmallinc-state.json"
if [ ! -f "$STATE_FILE" ]; then
    error "State file not found: $STATE_FILE"
fi

EC2_IP=$(jq -r '.elastic_ip' "$STATE_FILE")
KEY_NAME=$(jq -r '.key_name' "$STATE_FILE")
HOSTED_ZONE_ID=$(jq -r '.hosted_zone_id' "$STATE_FILE")
EC2_KEY="$HOME/.ssh/${KEY_NAME}.pem"

if [ -z "$EC2_IP" ] || [ "$EC2_IP" == "null" ]; then
    error "Could not find EC2 IP in state file"
fi

log "Deprovisioning customer: $CUSTOMER_NAME"

# ============================================================================
# Step 1: SSH into EC2 and run the deprovision script
# ============================================================================

log "Running deprovision on EC2..."

ssh -i "$EC2_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" \
    "sudo /opt/cloudmallinc/deprovision-customer.sh $CUSTOMER_NAME"

# ============================================================================
# Step 2: Remove Route53 DNS records
# ============================================================================

log "Removing Route53 DNS records..."

CHANGE_BATCH=$(cat <<EOF
{
    "Changes": [
        {
            "Action": "DELETE",
            "ResourceRecordSet": {
                "Name": "*.$CUSTOMER_NAME.$DOMAIN",
                "Type": "A",
                "TTL": 300,
                "ResourceRecords": [{"Value": "$EC2_IP"}]
            }
        },
        {
            "Action": "DELETE",
            "ResourceRecordSet": {
                "Name": "$CUSTOMER_NAME.$DOMAIN",
                "Type": "A",
                "TTL": 300,
                "ResourceRecords": [{"Value": "$EC2_IP"}]
            }
        }
    ]
}
EOF
)

aws route53 change-resource-record-sets \
    --hosted-zone-id "$HOSTED_ZONE_ID" \
    --change-batch "$CHANGE_BATCH" > /dev/null 2>&1 || warn "DNS records may have already been removed"

log "DNS records removed"

# ============================================================================
# Step 3: Update local state
# ============================================================================

CUSTOMERS_STATE="$(dirname "$0")/customers.json"

if [ -f "$CUSTOMERS_STATE" ]; then
    jq "del(.[] | select(.name == \"$CUSTOMER_NAME\"))" "$CUSTOMERS_STATE" > /tmp/customers.json
    mv /tmp/customers.json "$CUSTOMERS_STATE"
    log "Local state updated"
fi

# ============================================================================
# Done!
# ============================================================================

echo ""
log "Customer '$CUSTOMER_NAME' deprovisioned successfully!"
echo ""
