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

# Get latest Amazon Linux 2023 AMI
log "Finding latest Amazon Linux 2023 AMI..."
AMI_ID=$(aws ec2 describe-images \
    --region "$REGION" \
    --owners amazon \
    --filters "Name=name,Values=al2023-ami-2023*-x86_64" "Name=state,Values=available" \
    --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
    --output text)

if [ -z "$AMI_ID" ] || [ "$AMI_ID" == "None" ]; then
    error "Could not find Amazon Linux 2023 AMI"
fi
log "Using AMI: $AMI_ID"

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

USER_DATA=$(cat <<'EOF'
#!/bin/bash
set -e

# Update system
dnf update -y

# Install Docker
dnf install -y docker
systemctl enable docker
systemctl start docker
usermod -aG docker ec2-user

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Install Caddy
dnf install -y 'dnf-command(copr)'
dnf copr enable -y @caddy/caddy
dnf install -y caddy

# Create directories
mkdir -p /opt/cloudmallinc/{containers,caddy,logs}
mkdir -p /opt/cloudmallinc/caddy/data
mkdir -p /opt/cloudmallinc/caddy/config

# Create base Caddyfile (will be configured later)
cat > /opt/cloudmallinc/caddy/Caddyfile <<'CADDYFILE'
{
    email admin@cloudmallinc.com
    acme_dns route53 {
        access_key_id {$AWS_ACCESS_KEY_ID}
        secret_access_key {$AWS_SECRET_ACCESS_KEY}
        region {$AWS_REGION}
    }
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
CADDYFILE

# Create systemd service for Caddy with env vars
cat > /etc/systemd/system/cloudmallinc-caddy.service <<'SERVICE'
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
SERVICE

# Create placeholder env file (to be filled with AWS creds)
cat > /opt/cloudmallinc/caddy/.env <<'ENVFILE'
AWS_ACCESS_KEY_ID=REPLACE_ME
AWS_SECRET_ACCESS_KEY=REPLACE_ME
AWS_REGION=us-east-1
ENVFILE
chmod 600 /opt/cloudmallinc/caddy/.env

# Create helper scripts
cat > /opt/cloudmallinc/add-customer.sh <<'ADDCUST'
#!/bin/bash
# Usage: ./add-customer.sh <subdomain> <port>
SUBDOMAIN=$1
PORT=$2

if [ -z "$SUBDOMAIN" ] || [ -z "$PORT" ]; then
    echo "Usage: ./add-customer.sh <subdomain> <port>"
    exit 1
fi

# Add to Caddyfile
cat >> /opt/cloudmallinc/caddy/Caddyfile <<EOF

# Customer: $SUBDOMAIN
$SUBDOMAIN.cloudmallinc.com {
    reverse_proxy localhost:$PORT
}
EOF

# Reload Caddy
caddy reload --config /opt/cloudmallinc/caddy/Caddyfile
echo "Added $SUBDOMAIN.cloudmallinc.com -> localhost:$PORT"
ADDCUST
chmod +x /opt/cloudmallinc/add-customer.sh

# Mark setup complete
touch /opt/cloudmallinc/.setup-complete
echo "Setup complete at $(date)" >> /opt/cloudmallinc/setup.log
EOF
)

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
echo "  SSH Access:     ssh -i ~/.ssh/${KEY_NAME}.pem ec2-user@$ELASTIC_IP"
echo ""
echo "  NEXT STEPS:"
echo "  1. Wait 2-3 minutes for setup to complete"
echo "  2. SSH in and configure AWS credentials for Caddy:"
echo "     ssh -i ~/.ssh/${KEY_NAME}.pem ec2-user@$ELASTIC_IP"
echo "     sudo vi /opt/cloudmallinc/caddy/.env"
echo "  3. Start Caddy:"
echo "     sudo systemctl start cloudmallinc-caddy"
echo "     sudo systemctl enable cloudmallinc-caddy"
echo ""
echo "============================================================================"
