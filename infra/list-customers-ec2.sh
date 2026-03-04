#!/bin/bash
# ============================================================================
# list-customers.sh (EC2 version)
#
# This runs ON the EC2 box to list all customers.
# ============================================================================

DOMAIN=$(cat /opt/cloudmallinc/domain)
echo "Current customers:"
echo ""
if [ -s /opt/cloudmallinc/caddy/customers.json ] && [ "$(cat /opt/cloudmallinc/caddy/customers.json)" != "[]" ]; then
    cat /opt/cloudmallinc/caddy/customers.json | jq -r ".[] | \"  - \(.name) (port \(.port)) -> https://*.\(.name).$DOMAIN\""
else
    echo "  (none)"
fi
