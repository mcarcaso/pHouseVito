#!/bin/bash
set -e

# ============================================================================
# Provision Customer
# Creates a new customer: container, wildcard SSL cert, DNS, Caddy config
# 
# Usage: ./provision-customer.sh <username> [port]
# Example: ./provision-customer.sh mike 4001
# ============================================================================

CUSTOMER_NAME="$1"
CUSTOMER_PORT="${2:-}"
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
    echo "Usage: ./provision-customer.sh <username> [port]"
    echo "Example: ./provision-customer.sh mike 4001"
    exit 1
fi

# Validate customer name (lowercase, alphanumeric, hyphens only)
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
EC2_KEY="$HOME/.ssh/${KEY_NAME}.pem"
HOSTED_ZONE_ID=$(jq -r '.hosted_zone_id' "$STATE_FILE")

if [ -z "$EC2_IP" ] || [ "$EC2_IP" == "null" ]; then
    error "Could not find EC2 IP in state file"
fi

log "Provisioning customer: $CUSTOMER_NAME"
log "EC2 IP: $EC2_IP"

# ============================================================================
# Step 1: Find available port (if not specified)
# ============================================================================

if [ -z "$CUSTOMER_PORT" ]; then
    log "Finding available port..."
    
    # Get list of used ports from EC2
    USED_PORTS=$(ssh -i "$EC2_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" \
        "cat $CADDY_DIR/customers.json 2>/dev/null | jq -r '.[].port' || echo ''")
    
    # Start from 4001 and find first available
    CUSTOMER_PORT=4001
    while echo "$USED_PORTS" | grep -q "^$CUSTOMER_PORT$"; do
        CUSTOMER_PORT=$((CUSTOMER_PORT + 1))
    done
    
    log "Assigned port: $CUSTOMER_PORT"
else
    log "Using specified port: $CUSTOMER_PORT"
fi

# ============================================================================
# Step 2: Create Route53 DNS record for *.customer.cloudmallinc.com
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
# Step 3: Request wildcard SSL certificate via DNS challenge
# ============================================================================

log "Requesting wildcard SSL certificate for *.$CUSTOMER_NAME.$DOMAIN"

# Create temp directory for cert operations
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Use certbot with Route53 plugin
certbot certonly \
    --non-interactive \
    --agree-tos \
    --email "admin@$DOMAIN" \
    --dns-route53 \
    --dns-route53-propagation-seconds 30 \
    -d "$CUSTOMER_NAME.$DOMAIN" \
    -d "*.$CUSTOMER_NAME.$DOMAIN" \
    --config-dir "$TEMP_DIR/config" \
    --work-dir "$TEMP_DIR/work" \
    --logs-dir "$TEMP_DIR/logs"

CERT_PATH="$TEMP_DIR/config/live/$CUSTOMER_NAME.$DOMAIN"

if [ ! -f "$CERT_PATH/fullchain.pem" ]; then
    error "Certificate generation failed"
fi

log "Certificate generated successfully"

# ============================================================================
# Step 4: Upload certificate to EC2
# ============================================================================

log "Uploading certificate to EC2..."

ssh -i "$EC2_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" \
    "sudo mkdir -p $CERTS_DIR/$CUSTOMER_NAME"

scp -i "$EC2_KEY" -o StrictHostKeyChecking=no \
    "$CERT_PATH/fullchain.pem" \
    "$EC2_USER@$EC2_IP:/tmp/fullchain.pem"

scp -i "$EC2_KEY" -o StrictHostKeyChecking=no \
    "$CERT_PATH/privkey.pem" \
    "$EC2_USER@$EC2_IP:/tmp/privkey.pem"

ssh -i "$EC2_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" <<EOF
    sudo mv /tmp/fullchain.pem $CERTS_DIR/$CUSTOMER_NAME/
    sudo mv /tmp/privkey.pem $CERTS_DIR/$CUSTOMER_NAME/
    sudo chmod 600 $CERTS_DIR/$CUSTOMER_NAME/*.pem
    sudo chown caddy:caddy $CERTS_DIR/$CUSTOMER_NAME/*.pem
EOF

log "Certificate uploaded"

# ============================================================================
# Step 5: Start customer container
# ============================================================================

log "Starting customer container..."

ssh -i "$EC2_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" <<EOF
    # Create customer directory
    sudo mkdir -p $CONTAINERS_DIR/$CUSTOMER_NAME
    
    # Create docker-compose for customer container
    cat <<COMPOSE | sudo tee $CONTAINERS_DIR/$CUSTOMER_NAME/docker-compose.yml > /dev/null
version: '3.8'
services:
  vito:
    image: node:20-alpine
    container_name: vito-$CUSTOMER_NAME
    restart: unless-stopped
    ports:
      - "$CUSTOMER_PORT:3000"
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - CUSTOMER_NAME=$CUSTOMER_NAME
      - BASE_DOMAIN=$CUSTOMER_NAME.$DOMAIN
    command: sh -c "echo 'Vito container for $CUSTOMER_NAME - placeholder' && sleep infinity"
COMPOSE

    # Start the container
    cd $CONTAINERS_DIR/$CUSTOMER_NAME
    sudo docker compose up -d
EOF

log "Container started on port $CUSTOMER_PORT"

# ============================================================================
# Step 6: Update Caddy configuration
# ============================================================================

log "Updating Caddy configuration..."

ssh -i "$EC2_KEY" -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" <<EOF
    # Add customer to customers.json
    CUSTOMERS_FILE="$CADDY_DIR/customers.json"
    
    if [ ! -f "\$CUSTOMERS_FILE" ]; then
        echo '[]' | sudo tee \$CUSTOMERS_FILE > /dev/null
    fi
    
    # Add new customer entry
    sudo jq '. += [{"name": "$CUSTOMER_NAME", "port": $CUSTOMER_PORT, "domain": "$CUSTOMER_NAME.$DOMAIN"}]' \
        \$CUSTOMERS_FILE > /tmp/customers.json
    sudo mv /tmp/customers.json \$CUSTOMERS_FILE
    
    # Regenerate Caddyfile from customers.json
    sudo bash -c 'cat > $CADDY_DIR/Caddyfile <<CADDYFILE
{
    admin off
}

# Health check endpoint
$DOMAIN {
    respond /health "OK" 200
}

CADDYFILE'
    
    # Append each customer's config
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
EOF

log "Caddy configuration updated and reloaded"

# ============================================================================
# Step 7: Update local state
# ============================================================================

CUSTOMERS_STATE="$(dirname "$0")/customers.json"

if [ ! -f "$CUSTOMERS_STATE" ]; then
    echo '[]' > "$CUSTOMERS_STATE"
fi

jq ". += [{\"name\": \"$CUSTOMER_NAME\", \"port\": $CUSTOMER_PORT, \"domain\": \"$CUSTOMER_NAME.$DOMAIN\", \"created\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}]" \
    "$CUSTOMERS_STATE" > /tmp/customers.json
mv /tmp/customers.json "$CUSTOMERS_STATE"

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
echo "  Container:  vito-$CUSTOMER_NAME (port $CUSTOMER_PORT)"
echo ""
echo "  Certificate expires in 90 days"
echo "  Run: ./renew-certs.sh $CUSTOMER_NAME"
echo ""
