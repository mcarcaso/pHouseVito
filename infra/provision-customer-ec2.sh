#!/bin/bash
# ============================================================================
# provision-customer.sh (EC2 version)
#
# This runs ON the EC2 box to provision a new customer.
# What it does:
# 1. Request wildcard SSL cert via DNS challenge
# 2. Create customer user directory from template
# 3. Start Vito container with proper mounts
# 4. Update Caddy config to route traffic
# ============================================================================
set -e

CUSTOMER_NAME="$1"
CUSTOMER_PORT="${2:-}"
DOMAIN=$(cat /opt/cloudmallinc/domain)
AWS_ACCOUNT_ID=$(cat /opt/cloudmallinc/aws-account-id)
AWS_REGION=$(cat /opt/cloudmallinc/aws-region)
CERTS_DIR="/opt/cloudmallinc/certs"
CADDY_DIR="/opt/cloudmallinc/caddy"
CONTAINERS_DIR="/opt/cloudmallinc/containers"
ECR_REGISTRY="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
VITO_IMAGE="${VITO_IMAGE:-$ECR_REGISTRY/cloudmallinc/vito:latest}"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log() { echo -e "${GREEN}[✓]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

if [ -z "$CUSTOMER_NAME" ]; then
    echo "Usage: ./provision-customer.sh <username> [port]"
    exit 1
fi

if ! [[ "$CUSTOMER_NAME" =~ ^[a-z0-9-]+$ ]]; then
    error "Customer name must be lowercase alphanumeric with hyphens only"
fi

log "Provisioning customer: $CUSTOMER_NAME"

# ============================================================================
# Find available port
# ============================================================================

if [ -z "$CUSTOMER_PORT" ]; then
    USED_PORTS=$(cat $CADDY_DIR/customers.json | jq -r '.[].port' 2>/dev/null || echo '')
    CUSTOMER_PORT=4001
    while echo "$USED_PORTS" | grep -q "^$CUSTOMER_PORT$"; do
        CUSTOMER_PORT=$((CUSTOMER_PORT + 1))
    done
    log "Assigned port: $CUSTOMER_PORT"
fi

# ============================================================================
# Request wildcard SSL certificate via DNS challenge
# ============================================================================

log "Requesting wildcard SSL certificate for *.$CUSTOMER_NAME.$DOMAIN"

certbot certonly \
    --non-interactive \
    --agree-tos \
    --email "admin@$DOMAIN" \
    --dns-route53 \
    --dns-route53-propagation-seconds 30 \
    -d "$CUSTOMER_NAME.$DOMAIN" \
    -d "*.$CUSTOMER_NAME.$DOMAIN"

CERT_SRC="/etc/letsencrypt/live/$CUSTOMER_NAME.$DOMAIN"

if [ ! -f "$CERT_SRC/fullchain.pem" ]; then
    error "Certificate generation failed"
fi

log "Certificate generated successfully"

# Copy certs to cloudmallinc directory
mkdir -p $CERTS_DIR/$CUSTOMER_NAME
cp $CERT_SRC/fullchain.pem $CERTS_DIR/$CUSTOMER_NAME/
cp $CERT_SRC/privkey.pem $CERTS_DIR/$CUSTOMER_NAME/
chmod 600 $CERTS_DIR/$CUSTOMER_NAME/*.pem

log "Certificate copied to $CERTS_DIR/$CUSTOMER_NAME/"

# ============================================================================
# Set up customer directory structure from templates
# ============================================================================

log "Creating customer directory structure..."
mkdir -p $CONTAINERS_DIR/$CUSTOMER_NAME/user/{logs,images,skills,apps,memories}
mkdir -p $CONTAINERS_DIR/$CUSTOMER_NAME/data

# Copy template files from /opt/cloudmallinc/templates/
# These are uploaded from user.example/ during spinup
TEMPLATES_DIR="/opt/cloudmallinc/templates"

if [ -f "$TEMPLATES_DIR/config.json" ]; then
    cp "$TEMPLATES_DIR/config.json" $CONTAINERS_DIR/$CUSTOMER_NAME/user/config.json
else
    error "Template config.json not found at $TEMPLATES_DIR"
fi

if [ -f "$TEMPLATES_DIR/SOUL.md" ]; then
    cp "$TEMPLATES_DIR/SOUL.md" $CONTAINERS_DIR/$CUSTOMER_NAME/user/SOUL.md
else
    error "Template SOUL.md not found at $TEMPLATES_DIR"
fi

if [ -f "$TEMPLATES_DIR/secrets.json" ]; then
    cp "$TEMPLATES_DIR/secrets.json" $CONTAINERS_DIR/$CUSTOMER_NAME/user/secrets.json
else
    # Fallback: create empty secrets if template doesn't exist
    cat > $CONTAINERS_DIR/$CUSTOMER_NAME/user/secrets.json << 'SECRETS'
{
  "ANTHROPIC_API_KEY": "",
  "OPENAI_API_KEY": "",
  "GOOGLE_AI_API_KEY": ""
}
SECRETS
fi

chmod 600 $CONTAINERS_DIR/$CUSTOMER_NAME/user/secrets.json

log "Customer directory created"

# ============================================================================
# Create docker-compose.yml for customer container
# ============================================================================

log "Starting customer container..."

cat > $CONTAINERS_DIR/$CUSTOMER_NAME/docker-compose.yml << COMPOSE
services:
  vito:
    image: $VITO_IMAGE
    container_name: vito-$CUSTOMER_NAME
    restart: unless-stopped
    ports:
      - "$CUSTOMER_PORT:3000"
    volumes:
      # Customer's user directory (config, skills, apps, data)
      - ./user:/app/user
      # Persistent data (attachments, etc)
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - CUSTOMER_NAME=$CUSTOMER_NAME
      - BASE_DOMAIN=$CUSTOMER_NAME.$DOMAIN
      - AI_WORKSPACE=/app/user
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
COMPOSE

cd $CONTAINERS_DIR/$CUSTOMER_NAME

# Login to ECR to pull the Vito image
log "Logging into ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY >/dev/null 2>&1

docker compose up -d --quiet-pull >/dev/null 2>&1

log "Container started on port $CUSTOMER_PORT"

# ============================================================================
# Update customers registry
# ============================================================================

jq ". += [{\"name\": \"$CUSTOMER_NAME\", \"port\": $CUSTOMER_PORT, \"domain\": \"$CUSTOMER_NAME.$DOMAIN\", \"created\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}]" \
    $CADDY_DIR/customers.json > /tmp/customers.json
mv /tmp/customers.json $CADDY_DIR/customers.json

# ============================================================================
# Regenerate Caddyfile with all customers
# ============================================================================

cat > $CADDY_DIR/Caddyfile << CADDYFILE
{
    admin off
}

http://$DOMAIN {
    respond /health "OK" 200
    respond "CloudMall Inc Platform" 200
}
CADDYFILE

for row in $(cat $CADDY_DIR/customers.json | jq -c '.[]'); do
    NAME=$(echo $row | jq -r '.name')
    PORT=$(echo $row | jq -r '.port')
    
    cat >> $CADDY_DIR/Caddyfile << BLOCK

# Customer: $NAME
$NAME.$DOMAIN, *.$NAME.$DOMAIN {
    tls $CERTS_DIR/$NAME/fullchain.pem $CERTS_DIR/$NAME/privkey.pem
    reverse_proxy localhost:$PORT
}
BLOCK
done

# Reload Caddy (timeout to prevent hanging)
timeout 10 systemctl reload caddy 2>/dev/null || timeout 10 systemctl restart caddy 2>/dev/null || true

log "Caddy configuration updated"

# ============================================================================
# Done!
# ============================================================================

echo ""
echo "=============================================="
log "Customer '$CUSTOMER_NAME' provisioned!"
echo "=============================================="
echo ""
echo "  Dashboard:  https://$CUSTOMER_NAME.$DOMAIN"
echo "  Apps:       https://<appname>.$CUSTOMER_NAME.$DOMAIN"
echo "  Container:  vito-$CUSTOMER_NAME (port $CUSTOMER_PORT)"
echo ""
echo "  NEXT STEPS:"
echo "  1. Open https://$CUSTOMER_NAME.$DOMAIN"
echo "  2. Go to Settings > Secrets"
echo "  3. Add ANTHROPIC_API_KEY to enable the AI"
echo ""
echo "  Certs auto-renew via cron. No action needed."
echo ""
