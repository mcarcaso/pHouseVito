#!/bin/bash
set -e

# ============================================================================
# Provision Customer (Remote Wrapper)
# 
# This script runs from YOUR machine and SSHs into the EC2 to provision.
# The actual provisioning (certbot, docker, etc.) happens ON the EC2 box.
#
# Usage: ./provision-customer.sh <username> [port]
# Example: ./provision-customer.sh mike 4001
# ============================================================================

CUSTOMER_NAME="$1"
CUSTOMER_PORT="${2:-}"
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
    echo "Usage: ./provision-customer.sh <username> [port]"
    echo "Example: ./provision-customer.sh mike 4001"
    exit 1
fi

# Validate customer name
if ! [[ "$CUSTOMER_NAME" =~ ^[a-z0-9-]+$ ]]; then
    error "Customer name must be lowercase alphanumeric with hyphens only"
fi

# Load state file to get EC2 IP
STATE_FILE="$(dirname "$0")/cloudmallinc-state.json"
if [ ! -f "$STATE_FILE" ]; then
    error "State file not found: $STATE_FILE. Run spinup.sh first."
fi

EC2_IP=$(jq -r '.elastic_ip' "$STATE_FILE")
KEY_NAME=$(jq -r '.key_name' "$STATE_FILE")
HOSTED_ZONE_ID=$(jq -r '.hosted_zone_id' "$STATE_FILE")
EC2_KEY="$HOME/.ssh/${KEY_NAME}.pem"

if [ -z "$EC2_IP" ] || [ "$EC2_IP" == "null" ]; then
    error "Could not find EC2 IP in state file"
fi

if [ ! -f "$EC2_KEY" ]; then
    error "SSH key not found: $EC2_KEY"
fi

log "Provisioning customer: $CUSTOMER_NAME"
log "EC2 IP: $EC2_IP"

# ============================================================================
# Step 1: Create Route53 DNS record (from your machine with AWS creds)
# ============================================================================

log "Creating Route53 DNS record: *.$CUSTOMER_NAME.$DOMAIN -> $EC2_IP"

CHANGE_BATCH=$(cat <<EOF
{
    "Changes": [
        {
            "Action": "UPSERT",
            "ResourceRecordSet": {
                "Name": "*.$CUSTOMER_NAME.$DOMAIN",
                "Type": "A",
                "TTL": 300,
                "ResourceRecords": [{"Value": "$EC2_IP"}]
            }
        },
        {
            "Action": "UPSERT",
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
    --change-batch "$CHANGE_BATCH" > /dev/null

log "DNS records created"

# ============================================================================
# Step 2: Wait for DNS propagation (brief pause)
# ============================================================================

log "Waiting for DNS propagation..."
sleep 5

# ============================================================================
# Step 3: SSH into EC2 and run the provisioning script
# ============================================================================

log "Running provisioning on EC2..."

if [ -n "$CUSTOMER_PORT" ]; then
    PORT_ARG="$CUSTOMER_PORT"
else
    PORT_ARG=""
fi

ssh -i "$EC2_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" \
    "sudo /opt/cloudmallinc/provision-customer.sh $CUSTOMER_NAME $PORT_ARG"

# ============================================================================
# Step 4: Update local state
# ============================================================================

CUSTOMERS_STATE="$(dirname "$0")/customers.json"

if [ ! -f "$CUSTOMERS_STATE" ]; then
    echo '[]' > "$CUSTOMERS_STATE"
fi

# Get the port that was assigned (if auto-assigned)
ASSIGNED_PORT=$(ssh -i "$EC2_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" \
    "cat /opt/cloudmallinc/caddy/customers.json | jq -r '.[] | select(.name==\"$CUSTOMER_NAME\") | .port'")

jq ". += [{\"name\": \"$CUSTOMER_NAME\", \"port\": $ASSIGNED_PORT, \"domain\": \"$CUSTOMER_NAME.$DOMAIN\", \"created\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}]" \
    "$CUSTOMERS_STATE" > /tmp/customers.json
mv /tmp/customers.json "$CUSTOMERS_STATE"

log "Local state updated"

# ============================================================================
# Done!
# ============================================================================

echo ""
echo "=============================================="
log "Customer '$CUSTOMER_NAME' provisioned successfully!"
echo "=============================================="
echo ""
echo "  Dashboard:  https://$CUSTOMER_NAME.$DOMAIN"
echo "  Apps:       https://<appname>.$CUSTOMER_NAME.$DOMAIN"
echo "  Container:  vito-$CUSTOMER_NAME (port $ASSIGNED_PORT)"
echo ""
echo "  Certs auto-renew on the EC2 box. No manual work needed."
echo ""
