#!/bin/bash
#
# CloudMall Inc Platform Setup Script
# SCP this to your Ubuntu EC2 instance and run it as root
#
# Usage:
#   scp -i ~/.ssh/cloudmallinc-key.pem setup.sh ubuntu@<ip>:~/
#   ssh -i ~/.ssh/cloudmallinc-key.pem ubuntu@<ip>
#   sudo ./setup.sh
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    error "Please run as root (sudo ./setup.sh)"
fi

echo ""
echo "============================================"
echo "  CloudMall Inc Platform Setup"
echo "============================================"
echo ""

# -----------------------------------------
# Step 1: System Updates
# -----------------------------------------
log "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# -----------------------------------------
# Step 2: Install Docker
# -----------------------------------------
log "Installing Docker..."
apt-get install -y -qq ca-certificates curl gnupg lsb-release jq

# Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# Add the repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add ubuntu user to docker group
usermod -aG docker ubuntu

log "Docker installed: $(docker --version)"

# -----------------------------------------
# Step 3: Install Caddy (standard binary, no plugins needed)
# -----------------------------------------
log "Installing Caddy..."
apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq
apt-get install -y -qq caddy

log "Caddy installed: $(caddy version)"

# -----------------------------------------
# Step 4: Create directory structure
# -----------------------------------------
log "Creating directory structure..."
mkdir -p /opt/cloudmallinc/caddy
mkdir -p /opt/cloudmallinc/certs
mkdir -p /opt/cloudmallinc/containers
mkdir -p /var/log/caddy

# Create empty customers registry
echo '[]' > /opt/cloudmallinc/caddy/customers.json

# -----------------------------------------
# Step 5: Create initial Caddyfile
# -----------------------------------------
log "Creating Caddyfile..."
DOMAIN="cloudmallinc.com"

cat > /opt/cloudmallinc/caddy/Caddyfile << CADDYFILE_END
# CloudMall Inc Platform - Caddy Configuration
#
# SSL certificates are provisioned externally and stored in /opt/cloudmallinc/certs/
# Each customer gets: /opt/cloudmallinc/certs/<customer>/fullchain.pem and privkey.pem
#

{
    admin off
}

# Health check endpoint on the root domain
$DOMAIN {
    respond /health "OK" 200
    respond "CloudMall Inc Platform" 200
}

# Customer routes are added dynamically by provision-customer.sh

CADDYFILE_END

# -----------------------------------------
# Step 6: Create systemd service for Caddy
# -----------------------------------------
log "Creating Caddy systemd service..."
cat > /etc/systemd/system/caddy.service << 'SERVICE_END'
[Unit]
Description=Caddy web server for CloudMall Inc
Documentation=https://caddyserver.com/docs/
After=network.target network-online.target
Requires=network-online.target

[Service]
Type=notify
User=root
Group=root
ExecStart=/usr/bin/caddy run --config /opt/cloudmallinc/caddy/Caddyfile --adapter caddyfile
ExecReload=/usr/bin/caddy reload --config /opt/cloudmallinc/caddy/Caddyfile --adapter caddyfile
TimeoutStopSec=5s
LimitNOFILE=1048576
LimitNPROC=512
PrivateTmp=true
ProtectSystem=full
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
SERVICE_END

systemctl daemon-reload
systemctl enable caddy

# -----------------------------------------
# Step 7: Create helper scripts
# -----------------------------------------
log "Creating helper scripts..."

# Script to list customers
cat > /opt/cloudmallinc/list-customers.sh << 'SCRIPT_END'
#!/bin/bash
echo "Current customers:"
echo ""
cat /opt/cloudmallinc/caddy/customers.json | jq -r '.[] | "  - \(.name) (port \(.port)) -> https://\(.domain)"'
SCRIPT_END
chmod +x /opt/cloudmallinc/list-customers.sh

# -----------------------------------------
# Step 8: Start Caddy
# -----------------------------------------
log "Starting Caddy..."
systemctl start caddy

# -----------------------------------------
# Done!
# -----------------------------------------
echo ""
echo "============================================"
echo "  Setup Complete!"
echo "============================================"
echo ""
log "Docker installed and running"
log "Caddy installed and running"
log "Directory structure created"
echo ""
echo "  Directories:"
echo "    /opt/cloudmallinc/caddy/      - Caddyfile + customers.json"
echo "    /opt/cloudmallinc/certs/      - SSL certs per customer"
echo "    /opt/cloudmallinc/containers/ - Docker compose per customer"
echo ""
echo "  Commands:"
echo "    sudo systemctl status caddy   - Check Caddy status"
echo "    /opt/cloudmallinc/list-customers.sh - List customers"
echo ""
echo "  To add customers, run from YOUR machine:"
echo "    ./provision-customer.sh <name>"
echo ""
echo "  NO AWS CREDENTIALS NEEDED ON THIS BOX!"
echo "  Certs are provisioned externally and uploaded."
echo ""
