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
apt-get install -y -qq ca-certificates curl gnupg lsb-release

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
# Step 3: Install Go (needed for xcaddy)
# -----------------------------------------
log "Installing Go..."
GO_VERSION="1.22.0"
wget -q "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -O /tmp/go.tar.gz
rm -rf /usr/local/go
tar -C /usr/local -xzf /tmp/go.tar.gz
rm /tmp/go.tar.gz

export PATH=$PATH:/usr/local/go/bin
echo 'export PATH=$PATH:/usr/local/go/bin' >> /etc/profile.d/go.sh

log "Go installed: $(/usr/local/go/bin/go version)"

# -----------------------------------------
# Step 4: Build Caddy with Route53 DNS plugin
# -----------------------------------------
log "Installing xcaddy and building Caddy with Route53 plugin..."
/usr/local/go/bin/go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest

# Build caddy with route53 dns plugin
/root/go/bin/xcaddy build \
    --with github.com/caddy-dns/route53 \
    --output /usr/local/bin/caddy

chmod +x /usr/local/bin/caddy

log "Caddy installed: $(/usr/local/bin/caddy version)"

# -----------------------------------------
# Step 5: Create directory structure
# -----------------------------------------
log "Creating directory structure..."
mkdir -p /opt/cloudmallinc/caddy
mkdir -p /opt/cloudmallinc/customers
mkdir -p /var/log/caddy

# -----------------------------------------
# Step 6: Create Caddyfile
# -----------------------------------------
log "Creating Caddyfile..."
cat > /opt/cloudmallinc/caddy/Caddyfile << 'CADDYFILE_END'
# CloudMall Inc Platform - Caddy Configuration
#
# This handles wildcard SSL via Let's Encrypt + Route53 DNS challenge
# and routes subdomains to customer containers
#

# Global options
{
    email admin@cloudmallinc.com
    acme_dns route53
}

# Health check endpoint on the root domain
cloudmallinc.com {
    respond /health "OK" 200
    respond "CloudMall Inc Platform" 200
}

# Wildcard handler - routes *.cloudmallinc.com to containers
*.cloudmallinc.com {
    tls {
        dns route53
    }
    
    # Extract subdomain and proxy to the right container
    # Customer containers run on ports starting at 4000
    # Mapping is managed via /opt/cloudmallinc/customers/routing.json
    
    @customer {
        expression {http.request.host.labels.2} != ""
    }
    
    handle @customer {
        # For now, respond with a placeholder
        # We'll add dynamic routing once customers are set up
        respond "Customer portal: {http.request.host}" 200
    }
    
    handle {
        respond "Unknown subdomain" 404
    }
}
CADDYFILE_END

# -----------------------------------------
# Step 7: Create environment file template
# -----------------------------------------
log "Creating environment file template..."
cat > /opt/cloudmallinc/caddy/.env << 'ENV_END'
# AWS credentials for Route53 DNS challenge
# Fill these in with your AWS credentials that have Route53 permissions
AWS_ACCESS_KEY_ID=YOUR_ACCESS_KEY_HERE
AWS_SECRET_ACCESS_KEY=YOUR_SECRET_KEY_HERE
AWS_REGION=us-east-1
ENV_END

chmod 600 /opt/cloudmallinc/caddy/.env

# -----------------------------------------
# Step 8: Create systemd service for Caddy
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
EnvironmentFile=/opt/cloudmallinc/caddy/.env
ExecStart=/usr/local/bin/caddy run --config /opt/cloudmallinc/caddy/Caddyfile --adapter caddyfile
ExecReload=/usr/local/bin/caddy reload --config /opt/cloudmallinc/caddy/Caddyfile --adapter caddyfile
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
# Step 9: Create helper scripts
# -----------------------------------------
log "Creating helper scripts..."

# Script to add a new customer
cat > /opt/cloudmallinc/add-customer.sh << 'SCRIPT_END'
#!/bin/bash
#
# Add a new customer to the platform
# Usage: ./add-customer.sh <customer-name> <port>
#

CUSTOMER=$1
PORT=$2

if [ -z "$CUSTOMER" ] || [ -z "$PORT" ]; then
    echo "Usage: ./add-customer.sh <customer-name> <port>"
    echo "Example: ./add-customer.sh mike 4000"
    exit 1
fi

CADDYFILE="/opt/cloudmallinc/caddy/Caddyfile"

# Check if customer already exists
if grep -q "@${CUSTOMER}" "$CADDYFILE"; then
    echo "Customer '$CUSTOMER' already exists in Caddyfile"
    exit 1
fi

# Add customer route before the catch-all handle block
sed -i "/handle @customer {/i\\
    @${CUSTOMER} host ${CUSTOMER}.cloudmallinc.com\\
    handle @${CUSTOMER} {\\
        reverse_proxy localhost:${PORT}\\
    }\\
" "$CADDYFILE"

echo "Added customer '$CUSTOMER' on port $PORT"
echo "Reloading Caddy..."
systemctl reload caddy
echo "Done! https://${CUSTOMER}.cloudmallinc.com is now live"
SCRIPT_END
chmod +x /opt/cloudmallinc/add-customer.sh

# Script to remove a customer
cat > /opt/cloudmallinc/remove-customer.sh << 'SCRIPT_END'
#!/bin/bash
#
# Remove a customer from the platform
# Usage: ./remove-customer.sh <customer-name>
#

CUSTOMER=$1

if [ -z "$CUSTOMER" ]; then
    echo "Usage: ./remove-customer.sh <customer-name>"
    exit 1
fi

CADDYFILE="/opt/cloudmallinc/caddy/Caddyfile"

# Remove customer block (the @name matcher and handle block)
sed -i "/@${CUSTOMER} host/d" "$CADDYFILE"
sed -i "/handle @${CUSTOMER} {/,/}/d" "$CADDYFILE"

echo "Removed customer '$CUSTOMER'"
echo "Reloading Caddy..."
systemctl reload caddy
echo "Done!"
SCRIPT_END
chmod +x /opt/cloudmallinc/remove-customer.sh

# Script to list customers
cat > /opt/cloudmallinc/list-customers.sh << 'SCRIPT_END'
#!/bin/bash
#
# List all customers on the platform
#

echo "Current customers:"
grep -oP '@\K[a-z0-9-]+(?= host)' /opt/cloudmallinc/caddy/Caddyfile | while read customer; do
    port=$(grep -A2 "@${customer} host" /opt/cloudmallinc/caddy/Caddyfile | grep -oP 'localhost:\K[0-9]+')
    echo "  - $customer (port $port) -> https://${customer}.cloudmallinc.com"
done
SCRIPT_END
chmod +x /opt/cloudmallinc/list-customers.sh

# -----------------------------------------
# Done!
# -----------------------------------------
echo ""
echo "============================================"
echo "  Setup Complete!"
echo "============================================"
echo ""
log "Docker installed and running"
log "Caddy built with Route53 DNS plugin"
log "Systemd service created (not started yet)"
echo ""
warn "NEXT STEPS:"
echo ""
echo "  1. Add your AWS credentials:"
echo "     sudo nano /opt/cloudmallinc/caddy/.env"
echo ""
echo "  2. Start Caddy:"
echo "     sudo systemctl start caddy"
echo ""
echo "  3. Check status:"
echo "     sudo systemctl status caddy"
echo "     curl https://cloudmallinc.com/health"
echo ""
echo "  4. Add a customer:"
echo "     sudo /opt/cloudmallinc/add-customer.sh mike 4000"
echo ""
echo "  Helper scripts in /opt/cloudmallinc/:"
echo "     - add-customer.sh <name> <port>"
echo "     - remove-customer.sh <name>"
echo "     - list-customers.sh"
echo ""
