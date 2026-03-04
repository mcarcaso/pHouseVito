#!/bin/bash
# ============================================================================
# deprovision-customer.sh (EC2 version)
#
# This runs ON the EC2 box to remove a customer.
# ============================================================================
set -e

CUSTOMER_NAME="$1"
DOMAIN=$(cat /opt/cloudmallinc/domain)
CERTS_DIR="/opt/cloudmallinc/certs"
CADDY_DIR="/opt/cloudmallinc/caddy"
CONTAINERS_DIR="/opt/cloudmallinc/containers"

if [ -z "$CUSTOMER_NAME" ]; then
    echo "Usage: ./deprovision-customer.sh <username>"
    exit 1
fi

echo "Deprovisioning customer: $CUSTOMER_NAME"

# Stop and remove container
if [ -f "$CONTAINERS_DIR/$CUSTOMER_NAME/docker-compose.yml" ]; then
    cd $CONTAINERS_DIR/$CUSTOMER_NAME
    docker compose down || true
    rm -rf $CONTAINERS_DIR/$CUSTOMER_NAME
    echo "[✓] Container removed"
fi

# Remove certs
rm -rf $CERTS_DIR/$CUSTOMER_NAME
certbot delete --cert-name "$CUSTOMER_NAME.$DOMAIN" --non-interactive || true
echo "[✓] Certificates removed"

# Update customers.json
jq "del(.[] | select(.name == \"$CUSTOMER_NAME\"))" $CADDY_DIR/customers.json > /tmp/customers.json
mv /tmp/customers.json $CADDY_DIR/customers.json

# Regenerate Caddyfile
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

$NAME.$DOMAIN, *.$NAME.$DOMAIN {
    tls $CERTS_DIR/$NAME/fullchain.pem $CERTS_DIR/$NAME/privkey.pem
    reverse_proxy localhost:$PORT
}
BLOCK
done

systemctl reload caddy || systemctl restart caddy
echo "[✓] Customer '$CUSTOMER_NAME' deprovisioned"
