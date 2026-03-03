#!/bin/bash
set -e

# ============================================================================
# Deprovision Customer
# Removes a customer: stops container, deletes cert, DNS records, Caddy config
# 
# Usage: ./deprovision-customer.sh <username> [--force]
# Example: ./deprovision-customer.sh mike
# ============================================================================

CUSTOMER_NAME="$1"
FORCE="$2"
DOMAIN="cloudmallinc.com"
EC2_USER="ubuntu"
CERTS_DIR="/opt/cloudmallinc/certs"
CADDY_DIR="/opt/cloudmallinc/caddy"
CONTAINERS_DIR="/opt/cloudmallinc/containers"

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
    echo "Usage: ./deprovision-customer.sh <username> [--force]"
    echo "Example: ./deprovision-customer.sh mike"
    exit 1
fi

# Load state file to get EC2 IP
STATE_FILE="$(dirname "$0")/cloudmallinc-state.json"
if [ ! -f "$STATE_FILE" ]; then
    error "State file not found: $STATE_FILE"
fi

EC2_IP=$(jq -r '.elastic_ip' "$STATE_FILE")
EC2_KEY=$(jq -r '.key_file' "$STATE_FILE")
HOSTED_ZONE_ID=$(jq -r '.hosted_zone_id' "$STATE_FILE")

if [ -z "$EC2_IP" ] || [ "$EC2_IP" == "null" ]; then
    error "Could not find EC2 IP in state file"
fi

# Confirmation
if [ "$FORCE" != "--force" ]; then
    echo ""
    echo "⚠️  This will permanently delete:"
    echo "   - Container: vito-$CUSTOMER_NAME"
    echo "   - SSL certificate for *.$CUSTOMER_NAME.$DOMAIN"
    echo "   - DNS records for $CUSTOMER_NAME.$DOMAIN"
    echo "   - All customer data in $CONTAINERS_DIR/$CUSTOMER_NAME"
    echo ""
    read -p "Are you sure? (type 'yes' to confirm): " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
        echo "Aborted."
        exit 0
    fi
fi

log "Deprovisioning customer: $CUSTOMER_NAME"

# ============================================================================
# Step 1: Stop and remove container
# ============================================================================

log "Stopping customer container..."

ssh -i "$EC2_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" <<EOF
    if [ -d "$CONTAINERS_DIR/$CUSTOMER_NAME" ]; then
        cd $CONTAINERS_DIR/$CUSTOMER_NAME
        sudo docker compose down -v 2>/dev/null || true
        sudo rm -rf $CONTAINERS_DIR/$CUSTOMER_NAME
        echo "Container removed"
    else
        echo "No container directory found"
    fi
EOF

log "Container stopped and removed"

# ============================================================================
# Step 2: Remove certificate
# ============================================================================

log "Removing SSL certificate..."

ssh -i "$EC2_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" <<EOF
    sudo rm -rf $CERTS_DIR/$CUSTOMER_NAME
EOF

log "Certificate removed"

# ============================================================================
# Step 3: Update Caddy configuration
# ============================================================================

log "Updating Caddy configuration..."

ssh -i "$EC2_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" <<EOF
    CUSTOMERS_FILE="$CADDY_DIR/customers.json"
    
    if [ -f "\$CUSTOMERS_FILE" ]; then
        # Remove customer from customers.json
        sudo jq '[.[] | select(.name != "$CUSTOMER_NAME")]' \$CUSTOMERS_FILE > /tmp/customers.json
        sudo mv /tmp/customers.json \$CUSTOMERS_FILE
        
        # Regenerate Caddyfile
        sudo bash -c 'cat > $CADDY_DIR/Caddyfile <<CADDYFILE
{
    admin off
}

# Health check endpoint
$DOMAIN {
    respond /health "OK" 200
}

CADDYFILE'
        
        # Append remaining customers
        for row in \$(cat \$CUSTOMERS_FILE | jq -c '.[]'); do
            NAME=\$(echo \$row | jq -r '.name')
            PORT=\$(echo \$row | jq -r '.port')
            
            sudo bash -c "cat >> $CADDY_DIR/Caddyfile <<BLOCK

# Customer: \$NAME
\$NAME.$DOMAIN, *.\$NAME.$DOMAIN {
    tls $CERTS_DIR/\$NAME/fullchain.pem $CERTS_DIR/\$NAME/privkey.pem
    reverse_proxy localhost:\$PORT
}
BLOCK"
        done
        
        # Reload Caddy
        sudo systemctl reload caddy || sudo systemctl restart caddy
    fi
EOF

log "Caddy configuration updated"

# ============================================================================
# Step 4: Delete DNS records
# ============================================================================

log "Deleting Route53 DNS records..."

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
    --change-batch "$CHANGE_BATCH" > /dev/null 2>&1 || warn "DNS records may not exist or already deleted"

log "DNS records deleted"

# ============================================================================
# Step 5: Update local state
# ============================================================================

CUSTOMERS_STATE="$(dirname "$0")/customers.json"

if [ -f "$CUSTOMERS_STATE" ]; then
    jq "[.[] | select(.name != \"$CUSTOMER_NAME\")]" "$CUSTOMERS_STATE" > /tmp/customers.json
    mv /tmp/customers.json "$CUSTOMERS_STATE"
fi

# ============================================================================
# Done!
# ============================================================================

echo ""
echo "=============================================="
log "Customer '$CUSTOMER_NAME' deprovisioned successfully!"
echo "=============================================="
echo ""
