#!/bin/bash
set -e

# ============================================================================
# Renew Customer Certificate
# Renews wildcard SSL cert for a specific customer or all customers
# 
# Usage: ./renew-certs.sh [username]
# Example: ./renew-certs.sh mike     # Renew just mike's cert
# Example: ./renew-certs.sh          # Renew all certs
# ============================================================================

CUSTOMER_NAME="$1"
DOMAIN="cloudmallinc.com"
EC2_USER="ubuntu"
CERTS_DIR="/opt/cloudmallinc/certs"
CADDY_DIR="/opt/cloudmallinc/caddy"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# Load state file
STATE_FILE="$(dirname "$0")/cloudmallinc-state.json"
CUSTOMERS_STATE="$(dirname "$0")/customers.json"

if [ ! -f "$STATE_FILE" ]; then
    error "State file not found: $STATE_FILE"
fi

EC2_IP=$(jq -r '.elastic_ip' "$STATE_FILE")
EC2_KEY=$(jq -r '.key_file' "$STATE_FILE")

if [ -z "$EC2_IP" ] || [ "$EC2_IP" == "null" ]; then
    error "Could not find EC2 IP in state file"
fi

# Function to renew a single customer's cert
renew_customer() {
    local CUST="$1"
    log "Renewing certificate for $CUST.$DOMAIN..."
    
    TEMP_DIR=$(mktemp -d)
    trap "rm -rf $TEMP_DIR" RETURN
    
    # Request new cert
    certbot certonly \
        --non-interactive \
        --agree-tos \
        --email "admin@$DOMAIN" \
        --dns-route53 \
        --dns-route53-propagation-seconds 30 \
        -d "$CUST.$DOMAIN" \
        -d "*.$CUST.$DOMAIN" \
        --config-dir "$TEMP_DIR/config" \
        --work-dir "$TEMP_DIR/work" \
        --logs-dir "$TEMP_DIR/logs" \
        --force-renewal
    
    CERT_PATH="$TEMP_DIR/config/live/$CUST.$DOMAIN"
    
    if [ ! -f "$CERT_PATH/fullchain.pem" ]; then
        warn "Certificate renewal failed for $CUST"
        return 1
    fi
    
    # Upload to EC2
    scp -i "$EC2_KEY" -o StrictHostKeyChecking=no \
        "$CERT_PATH/fullchain.pem" \
        "$EC2_USER@$EC2_IP:/tmp/fullchain.pem"
    
    scp -i "$EC2_KEY" -o StrictHostKeyChecking=no \
        "$CERT_PATH/privkey.pem" \
        "$EC2_USER@$EC2_IP:/tmp/privkey.pem"
    
    ssh -i "$EC2_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" <<EOF
        sudo mv /tmp/fullchain.pem $CERTS_DIR/$CUST/
        sudo mv /tmp/privkey.pem $CERTS_DIR/$CUST/
        sudo chmod 600 $CERTS_DIR/$CUST/*.pem
        sudo chown caddy:caddy $CERTS_DIR/$CUST/*.pem
EOF
    
    log "Certificate renewed for $CUST"
}

# Main logic
if [ -n "$CUSTOMER_NAME" ]; then
    # Renew single customer
    renew_customer "$CUSTOMER_NAME"
else
    # Renew all customers
    if [ ! -f "$CUSTOMERS_STATE" ]; then
        error "No customers found (customers.json missing)"
    fi
    
    CUSTOMERS=$(jq -r '.[].name' "$CUSTOMERS_STATE")
    
    if [ -z "$CUSTOMERS" ]; then
        warn "No customers to renew"
        exit 0
    fi
    
    for CUST in $CUSTOMERS; do
        renew_customer "$CUST" || true
    done
fi

# Reload Caddy to pick up new certs
log "Reloading Caddy..."
ssh -i "$EC2_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" \
    "sudo systemctl reload caddy"

echo ""
log "Certificate renewal complete!"
