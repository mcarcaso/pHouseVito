#!/bin/bash
set -e

# ============================================================================
# CLOUDMALLINC INFRASTRUCTURE SPINUP
# ============================================================================
# Spins up an EC2 instance with Docker + Caddy for the whitelabel AI platform
# Usage: ./spinup.sh [--key-name your-key] [--instance-type t3.small]
# ============================================================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ============================================================================
# CONFIGURATION
# ============================================================================

DOMAIN="cloudmallinc.com"
INSTANCE_NAME="cloudmallinc-platform"
REGION="${AWS_REGION:-us-east-1}"
INSTANCE_TYPE="t3.small"
KEY_NAME=""
AMI_ID=""  # Will auto-detect latest Amazon Linux 2023

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --key-name) KEY_NAME="$2"; shift 2 ;;
        --instance-type) INSTANCE_TYPE="$2"; shift 2 ;;
        --region) REGION="$2"; shift 2 ;;
        *) error "Unknown option: $1" ;;
    esac
done

# ============================================================================
# PRE-FLIGHT CHECKS
# ============================================================================

log "Running pre-flight checks..."

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    error "AWS CLI not found. Install it first: brew install awscli"
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    error "AWS credentials not configured. Run: aws configure"
fi

# Get or create key pair
if [ -z "$KEY_NAME" ]; then
    KEY_NAME="cloudmallinc-key"
    if ! aws ec2 describe-key-pairs --key-names "$KEY_NAME" --region "$REGION" &> /dev/null; then
        log "Creating new key pair: $KEY_NAME"
        aws ec2 create-key-pair \
            --key-name "$KEY_NAME" \
            --region "$REGION" \
            --query 'KeyMaterial' \
            --output text > ~/.ssh/${KEY_NAME}.pem
        chmod 600 ~/.ssh/${KEY_NAME}.pem
        log "Key saved to ~/.ssh/${KEY_NAME}.pem"
    else
        warn "Using existing key pair: $KEY_NAME"
    fi
fi

# Get latest Ubuntu 22.04 LTS AMI
log "Finding latest Ubuntu 22.04 LTS AMI..."
AMI_ID=$(aws ec2 describe-images \
    --region "$REGION" \
    --owners 099720109477 \
    --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" "Name=state,Values=available" \
    --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
    --output text)

if [ -z "$AMI_ID" ] || [ "$AMI_ID" == "None" ]; then
    error "Could not find Ubuntu 22.04 LTS AMI"
fi
log "Using AMI: $AMI_ID (Ubuntu 22.04 LTS)"

# ============================================================================
# SECURITY GROUP
# ============================================================================

SG_NAME="cloudmallinc-sg"
SG_ID=$(aws ec2 describe-security-groups \
    --region "$REGION" \
    --filters "Name=group-name,Values=$SG_NAME" \
    --query 'SecurityGroups[0].GroupId' \
    --output text 2>/dev/null)

if [ "$SG_ID" == "None" ] || [ -z "$SG_ID" ]; then
    log "Creating security group: $SG_NAME"
    SG_ID=$(aws ec2 create-security-group \
        --group-name "$SG_NAME" \
        --description "CloudMall Inc Platform Security Group" \
        --region "$REGION" \
        --query 'GroupId' \
        --output text)
    
    # Allow SSH
    aws ec2 authorize-security-group-ingress \
        --group-id "$SG_ID" \
        --protocol tcp \
        --port 22 \
        --cidr 0.0.0.0/0 \
        --region "$REGION"
    
    # Allow HTTP
    aws ec2 authorize-security-group-ingress \
        --group-id "$SG_ID" \
        --protocol tcp \
        --port 80 \
        --cidr 0.0.0.0/0 \
        --region "$REGION"
    
    # Allow HTTPS
    aws ec2 authorize-security-group-ingress \
        --group-id "$SG_ID" \
        --protocol tcp \
        --port 443 \
        --cidr 0.0.0.0/0 \
        --region "$REGION"
    
    log "Security group created: $SG_ID"
else
    warn "Using existing security group: $SG_ID"
fi

# ============================================================================
# USER DATA SCRIPT (runs on first boot)
# ============================================================================

# Write user data to a temp file to avoid heredoc nesting issues
USER_DATA_FILE=$(mktemp)
cat > "$USER_DATA_FILE" << 'USERDATA_END'
#!/bin/bash
set -e

exec > /var/log/user-data.log 2>&1

echo "Starting CloudMallInc setup..."

# Wait for apt to be available (cloud-init sometimes holds the lock)
while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do
    echo "Waiting for apt lock..."
    sleep 5
done

# Update system
apt-get update -y
apt-get upgrade -y

# Install Docker
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker
systemctl start docker
usermod -aG docker ubuntu

# Install Go (needed for xcaddy)
apt-get install -y golang-go

# Install xcaddy and build Caddy with Route53 DNS plugin
go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
/root/go/bin/xcaddy build --with github.com/caddy-dns/route53 --output /usr/bin/caddy
chmod +x /usr/bin/caddy

# Create directories
mkdir -p /opt/cloudmallinc/containers
mkdir -p /opt/cloudmallinc/caddy/data
mkdir -p /opt/cloudmallinc/caddy/config
mkdir -p /opt/cloudmallinc/logs

# Create base Caddyfile
cat > /opt/cloudmallinc/caddy/Caddyfile << 'CADDYFILE_END'
{
    email admin@cloudmallinc.com
}

# Wildcard cert for all subdomains
*.cloudmallinc.com {
    tls {
        dns route53 {
            access_key_id {$AWS_ACCESS_KEY_ID}
            secret_access_key {$AWS_SECRET_ACCESS_KEY}
            region {$AWS_REGION}
        }
    }
    
    # Default response until containers are configured
    respond "Service not configured" 503
}

# Health check endpoint on main domain
cloudmallinc.com {
    respond /health "OK" 200
    respond "CloudMall Inc Platform" 200
}
CADDYFILE_END

# Create systemd service for Caddy
cat > /etc/systemd/system/cloudmallinc-caddy.service << 'SERVICE_END'
[Unit]
Description=CloudMall Inc Caddy Reverse Proxy
After=network.target

[Service]
Type=simple
EnvironmentFile=/opt/cloudmallinc/caddy/.env
ExecStart=/usr/bin/caddy run --config /opt/cloudmallinc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /opt/cloudmallinc/caddy/Caddyfile
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE_END

# Create placeholder env file
cat > /opt/cloudmallinc/caddy/.env << 'ENV_END'
AWS_ACCESS_KEY_ID=REPLACE_ME
AWS_SECRET_ACCESS_KEY=REPLACE_ME
AWS_REGION=us-east-1
ENV_END
chmod 600 /opt/cloudmallinc/caddy/.env

# Create helper script for adding customers
cat > /opt/cloudmallinc/add-customer.sh << 'ADDCUST_END'
#!/bin/bash
# Usage: ./add-customer.sh <subdomain> <port>
SUBDOMAIN=$1
PORT=$2

if [ -z "$SUBDOMAIN" ] || [ -z "$PORT" ]; then
    echo "Usage: ./add-customer.sh <subdomain> <port>"
    exit 1
fi

# Add to Caddyfile
echo "" >> /opt/cloudmallinc/caddy/Caddyfile
echo "# Customer: $SUBDOMAIN" >> /opt/cloudmallinc/caddy/Caddyfile
echo "$SUBDOMAIN.cloudmallinc.com {" >> /opt/cloudmallinc/caddy/Caddyfile
echo "    reverse_proxy localhost:$PORT" >> /opt/cloudmallinc/caddy/Caddyfile
echo "}" >> /opt/cloudmallinc/caddy/Caddyfile

# Reload Caddy
caddy reload --config /opt/cloudmallinc/caddy/Caddyfile
echo "Added $SUBDOMAIN.cloudmallinc.com -> localhost:$PORT"
ADDCUST_END
chmod +x /opt/cloudmallinc/add-customer.sh

# Enable systemd service (don't start yet - needs AWS creds)
systemctl daemon-reload
systemctl enable cloudmallinc-caddy

# Mark setup complete
touch /opt/cloudmallinc/.setup-complete
echo "Setup complete at $(date)" > /opt/cloudmallinc/setup.log
USERDATA_END

USER_DATA=$(cat "$USER_DATA_FILE")
rm -f "$USER_DATA_FILE"

# ============================================================================
# LAUNCH EC2 INSTANCE
# ============================================================================

log "Launching EC2 instance..."

INSTANCE_ID=$(aws ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SG_ID" \
    --region "$REGION" \
    --user-data "$USER_DATA" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME}]" \
    --query 'Instances[0].InstanceId' \
    --output text)

log "Instance launched: $INSTANCE_ID"
log "Waiting for instance to be running..."

aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"

# ============================================================================
# ALLOCATE & ASSOCIATE ELASTIC IP
# ============================================================================

log "Allocating Elastic IP..."

ALLOCATION_ID=$(aws ec2 allocate-address \
    --domain vpc \
    --region "$REGION" \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$INSTANCE_NAME-eip}]" \
    --query 'AllocationId' \
    --output text)

ELASTIC_IP=$(aws ec2 describe-addresses \
    --allocation-ids "$ALLOCATION_ID" \
    --region "$REGION" \
    --query 'Addresses[0].PublicIp' \
    --output text)

log "Elastic IP allocated: $ELASTIC_IP"

aws ec2 associate-address \
    --instance-id "$INSTANCE_ID" \
    --allocation-id "$ALLOCATION_ID" \
    --region "$REGION" > /dev/null

log "Elastic IP associated with instance"

# ============================================================================
# UPDATE ROUTE 53
# ============================================================================

log "Updating Route 53 DNS..."

HOSTED_ZONE_ID=$(aws route53 list-hosted-zones \
    --query "HostedZones[?Name=='${DOMAIN}.'].Id" \
    --output text | sed 's|/hostedzone/||')

if [ -z "$HOSTED_ZONE_ID" ] || [ "$HOSTED_ZONE_ID" == "None" ]; then
    error "Could not find hosted zone for $DOMAIN"
fi

# Create/update wildcard A record
aws route53 change-resource-record-sets \
    --hosted-zone-id "$HOSTED_ZONE_ID" \
    --change-batch '{
        "Changes": [{
            "Action": "UPSERT",
            "ResourceRecordSet": {
                "Name": "*.'"$DOMAIN"'",
                "Type": "A",
                "TTL": 300,
                "ResourceRecords": [{"Value": "'"$ELASTIC_IP"'"}]
            }
        }]
    }' > /dev/null

# Create/update root domain A record
aws route53 change-resource-record-sets \
    --hosted-zone-id "$HOSTED_ZONE_ID" \
    --change-batch '{
        "Changes": [{
            "Action": "UPSERT",
            "ResourceRecordSet": {
                "Name": "'"$DOMAIN"'",
                "Type": "A",
                "TTL": 300,
                "ResourceRecords": [{"Value": "'"$ELASTIC_IP"'"}]
            }
        }]
    }' > /dev/null

log "DNS records updated: *.${DOMAIN} -> $ELASTIC_IP"

# ============================================================================
# SAVE STATE
# ============================================================================

STATE_FILE="$(dirname "$0")/cloudmallinc-state.json"
cat > "$STATE_FILE" <<EOF
{
    "instance_id": "$INSTANCE_ID",
    "elastic_ip": "$ELASTIC_IP",
    "allocation_id": "$ALLOCATION_ID",
    "security_group_id": "$SG_ID",
    "key_name": "$KEY_NAME",
    "region": "$REGION",
    "domain": "$DOMAIN",
    "hosted_zone_id": "$HOSTED_ZONE_ID",
    "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

log "State saved to $STATE_FILE"

# ============================================================================
# DONE
# ============================================================================

echo ""
echo "============================================================================"
echo -e "${GREEN}INFRASTRUCTURE READY${NC}"
echo "============================================================================"
echo ""
echo "  Instance ID:    $INSTANCE_ID"
echo "  Elastic IP:     $ELASTIC_IP"
echo "  Domain:         https://$DOMAIN"
echo "  Wildcard:       https://*.${DOMAIN}"
echo ""
echo "  SSH Access:     ssh -i ~/.ssh/${KEY_NAME}.pem ubuntu@$ELASTIC_IP"
echo ""
echo "  NEXT STEPS:"
echo "  1. Wait 2-3 minutes for setup to complete"
echo "  2. SSH in and configure AWS credentials for Caddy:"
echo "     ssh -i ~/.ssh/${KEY_NAME}.pem ubuntu@$ELASTIC_IP"
echo "     sudo vi /opt/cloudmallinc/caddy/.env"
echo "  3. Start Caddy:"
echo "     sudo systemctl start cloudmallinc-caddy"
echo "     sudo systemctl enable cloudmallinc-caddy"
echo ""
echo "============================================================================"
