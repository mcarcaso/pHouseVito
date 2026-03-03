#!/bin/bash

# ============================================================================
# List Customers
# 
# Shows all provisioned customers on the EC2 box
#
# Usage: ./list-customers.sh
# ============================================================================

STATE_FILE="$(dirname "$0")/cloudmallinc-state.json"

if [ ! -f "$STATE_FILE" ]; then
    echo "State file not found. Run spinup.sh first."
    exit 1
fi

EC2_IP=$(jq -r '.elastic_ip' "$STATE_FILE")
KEY_NAME=$(jq -r '.key_name' "$STATE_FILE")
EC2_KEY="$HOME/.ssh/${KEY_NAME}.pem"

if [ -z "$EC2_IP" ] || [ "$EC2_IP" == "null" ]; then
    echo "Could not find EC2 IP in state file"
    exit 1
fi

echo "Fetching customers from EC2..."
echo ""

ssh -i "$EC2_KEY" -o StrictHostKeyChecking=no "ubuntu@$EC2_IP" \
    "/opt/cloudmallinc/list-customers.sh"
