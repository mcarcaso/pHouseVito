#!/bin/bash
# ============================================================================
# post-renew.sh (EC2 version)
#
# Called by certbot after successful renewal.
# Copies renewed certs and reloads Caddy.
# ============================================================================

CERTS_DIR="/opt/cloudmallinc/certs"
CADDY_DIR="/opt/cloudmallinc/caddy"

# Copy renewed certs to our directory
for row in $(cat $CADDY_DIR/customers.json | jq -c '.[]'); do
    NAME=$(echo $row | jq -r '.name')
    DOMAIN=$(cat /opt/cloudmallinc/domain)
    SRC="/etc/letsencrypt/live/$NAME.$DOMAIN"
    
    if [ -d "$SRC" ]; then
        cp $SRC/fullchain.pem $CERTS_DIR/$NAME/
        cp $SRC/privkey.pem $CERTS_DIR/$NAME/
        chmod 600 $CERTS_DIR/$NAME/*.pem
    fi
done

# Reload Caddy
systemctl reload caddy
