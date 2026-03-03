#!/bin/bash

# ============================================================================
# List Customers
# Shows all provisioned customers with their details
# 
# Usage: ./list-customers.sh
# ============================================================================

CUSTOMERS_STATE="$(dirname "$0")/customers.json"
DOMAIN="cloudmallinc.com"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

if [ ! -f "$CUSTOMERS_STATE" ]; then
    echo "No customers provisioned yet."
    echo "Run: ./provision-customer.sh <username>"
    exit 0
fi

CUSTOMERS=$(jq -r '.[] | @base64' "$CUSTOMERS_STATE")

if [ -z "$CUSTOMERS" ]; then
    echo "No customers provisioned yet."
    exit 0
fi

echo ""
echo "========================================"
echo "       PROVISIONED CUSTOMERS"
echo "========================================"
echo ""

printf "${CYAN}%-12s %-6s %-30s %s${NC}\n" "NAME" "PORT" "DOMAIN" "CREATED"
echo "------------------------------------------------------------------------"

for row in $CUSTOMERS; do
    _jq() {
        echo "$row" | base64 --decode | jq -r "${1}"
    }
    
    NAME=$(_jq '.name')
    PORT=$(_jq '.port')
    DOMAIN_FULL=$(_jq '.domain')
    CREATED=$(_jq '.created')
    
    printf "%-12s %-6s %-30s %s\n" "$NAME" "$PORT" "$DOMAIN_FULL" "$CREATED"
done

echo ""
echo "Total: $(jq '. | length' "$CUSTOMERS_STATE") customer(s)"
echo ""
