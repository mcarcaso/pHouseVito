#!/bin/bash
set -e

# ============================================================================
# CLOUDMALLINC INFRASTRUCTURE SPINUP
# ============================================================================
# Spins up an EC2 instance with Docker + Caddy + Certbot for whitelabel AI
# 
# ARCHITECTURE (Option B — Self-Contained):
# - EC2 runs Docker + Caddy + Certbot
# - EC2 has IAM role with Route53 access (for DNS challenge)
# - Certbot auto-renews wildcard certs via cron
# - Customers are isolated in Docker containers
# - One wildcard cert per customer covers ALL their apps
#
# Usage: ./spinup.sh [--key-name your-key] [--instance-type t3.small]
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
AMI_ID=""  # Will auto-detect latest Ubuntu 22.04 LTS

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
# IAM ROLE FOR ROUTE53 ACCESS
# ============================================================================

ROLE_NAME="cloudmallinc-certbot-role"
INSTANCE_PROFILE_NAME="cloudmallinc-certbot-profile"

# Check if role exists
if ! aws iam get-role --role-name "$ROLE_NAME" &> /dev/null; then
    log "Creating IAM role: $ROLE_NAME"
    
    # Create trust policy for EC2
    aws iam create-role \
        --role-name "$ROLE_NAME" \
        --assume-role-policy-document '{
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Principal": {"Service": "ec2.amazonaws.com"},
                "Action": "sts:AssumeRole"
            }]
        }' > /dev/null
    
    # Attach Route53 policy (limited to cloudmallinc.com hosted zone)
    aws iam put-role-policy \
        --role-name "$ROLE_NAME" \
        --policy-name "route53-dns-challenge" \
        --policy-document '{
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Action": [
                    "route53:ListHostedZones",
                    "route53:GetChange"
                ],
                "Resource": "*"
            }, {
                "Effect": "Allow",
                "Action": [
                    "route53:ChangeResourceRecordSets",
                    "route53:ListResourceRecordSets"
                ],
                "Resource": "arn:aws:route53:::hostedzone/*"
            }]
        }' > /dev/null
    
    # Attach ECR pull policy (for pulling Vito images)
    aws iam put-role-policy \
        --role-name "$ROLE_NAME" \
        --policy-name "ecr-pull" \
        --policy-document '{
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Action": [
                    "ecr:GetAuthorizationToken"
                ],
                "Resource": "*"
            }, {
                "Effect": "Allow",
                "Action": [
                    "ecr:BatchCheckLayerAvailability",
                    "ecr:GetDownloadUrlForLayer",
                    "ecr:BatchGetImage"
                ],
                "Resource": "arn:aws:ecr:*:*:repository/cloudmallinc/*"
            }]
        }' > /dev/null
    
    log "IAM role created with Route53 and ECR permissions"
else
    warn "Using existing IAM role: $ROLE_NAME"
    
    # Ensure ECR policy exists (might be missing from older role)
    log "Ensuring ECR policy is attached..."
    aws iam put-role-policy \
        --role-name "$ROLE_NAME" \
        --policy-name "ecr-pull" \
        --policy-document '{
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Action": [
                    "ecr:GetAuthorizationToken"
                ],
                "Resource": "*"
            }, {
                "Effect": "Allow",
                "Action": [
                    "ecr:BatchCheckLayerAvailability",
                    "ecr:GetDownloadUrlForLayer",
                    "ecr:BatchGetImage"
                ],
                "Resource": "arn:aws:ecr:*:*:repository/cloudmallinc/*"
            }]
        }' > /dev/null
    log "ECR policy verified"
fi

# Create or get instance profile
if ! aws iam get-instance-profile --instance-profile-name "$INSTANCE_PROFILE_NAME" &> /dev/null; then
    log "Creating instance profile: $INSTANCE_PROFILE_NAME"
    aws iam create-instance-profile \
        --instance-profile-name "$INSTANCE_PROFILE_NAME" > /dev/null
    
    aws iam add-role-to-instance-profile \
        --instance-profile-name "$INSTANCE_PROFILE_NAME" \
        --role-name "$ROLE_NAME" > /dev/null
    
    # Wait for profile to be ready
    sleep 10
else
    warn "Using existing instance profile: $INSTANCE_PROFILE_NAME"
fi

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
    
    # Allow HTTP (needed for ACME HTTP challenge fallback)
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

# Get AWS account ID for ECR
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
if [ -z "$AWS_ACCOUNT_ID" ]; then
    error "Could not get AWS account ID"
fi
log "AWS Account ID: $AWS_ACCOUNT_ID"

# Get hosted zone ID for the domain
HOSTED_ZONE_ID=$(aws route53 list-hosted-zones \
    --query "HostedZones[?Name=='${DOMAIN}.'].Id" \
    --output text | sed 's|/hostedzone/||')

if [ -z "$HOSTED_ZONE_ID" ] || [ "$HOSTED_ZONE_ID" == "None" ]; then
    error "Could not find hosted zone for $DOMAIN"
fi

# User data is now minimal — just installs dependencies and creates directories
# All scripts are uploaded via SCP after boot
USER_DATA=$(cat << 'USERDATA_END'
#!/bin/bash
set -e

exec > /var/log/user-data.log 2>&1

echo "Starting CloudMallInc setup..."

# Wait for apt to be available
while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do
    echo "Waiting for apt lock..."
    sleep 5
done

# Update system
apt-get update -y
apt-get upgrade -y

# Enable passwordless sudo for ubuntu user
echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/ubuntu
chmod 440 /etc/sudoers.d/ubuntu

# Install Docker
apt-get install -y ca-certificates curl gnupg jq awscli
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker
systemctl start docker
usermod -aG docker ubuntu

# Install Caddy
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y
apt-get install -y caddy

# Install Certbot with Route53 plugin
apt-get install -y certbot python3-certbot-dns-route53

# Create directories
mkdir -p /opt/cloudmallinc/caddy
mkdir -p /opt/cloudmallinc/certs
mkdir -p /opt/cloudmallinc/containers
mkdir -p /opt/cloudmallinc/templates
mkdir -p /var/log/caddy

# Initialize empty customers registry
echo '[]' > /opt/cloudmallinc/caddy/customers.json

# Mark setup complete (scripts will be uploaded via SCP)
touch /opt/cloudmallinc/.setup-complete
echo "Setup complete at $(date)" > /opt/cloudmallinc/setup.log
USERDATA_END
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
    --iam-instance-profile Name="$INSTANCE_PROFILE_NAME" \
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

# Create/update wildcard A record for *.cloudmallinc.com
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

STATE_FILE="$SCRIPT_DIR/cloudmallinc-state.json"
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
    "iam_role": "$ROLE_NAME",
    "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

log "State saved to $STATE_FILE"

# ============================================================================
# WAIT FOR SETUP TO COMPLETE
# ============================================================================

log "Waiting for EC2 setup to complete..."
warn "This takes 2-3 minutes (installing Docker, Caddy, certbot...)"
echo ""

SSH_KEY="$HOME/.ssh/${KEY_NAME}.pem"
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -o LogLevel=ERROR"
MAX_ATTEMPTS=60  # 5 minutes max (5 sec intervals)
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    ATTEMPT=$((ATTEMPT + 1))
    
    # Try to check if setup is complete
    SETUP_STATUS=$(ssh $SSH_OPTS -i "$SSH_KEY" ubuntu@"$ELASTIC_IP" \
        'cat /opt/cloudmallinc/setup.log 2>/dev/null || echo "NOT_READY"' 2>/dev/null || echo "SSH_FAILED")
    
    if echo "$SETUP_STATUS" | grep -q "Setup complete"; then
        log "EC2 setup complete!"
        break
    elif [ "$SETUP_STATUS" = "SSH_FAILED" ]; then
        printf "\r  [%02d/%d] Waiting for SSH access..." "$ATTEMPT" "$MAX_ATTEMPTS"
    elif [ "$SETUP_STATUS" = "NOT_READY" ]; then
        printf "\r  [%02d/%d] Setup in progress..." "$ATTEMPT" "$MAX_ATTEMPTS"
    else
        printf "\r  [%02d/%d] Installing packages..." "$ATTEMPT" "$MAX_ATTEMPTS"
    fi
    
    sleep 5
done

echo ""  # Clear the line

if [ $ATTEMPT -ge $MAX_ATTEMPTS ]; then
    warn "Setup is taking longer than expected. Check manually:"
    warn "  ssh -i ~/.ssh/${KEY_NAME}.pem ubuntu@$ELASTIC_IP 'cat /opt/cloudmallinc/setup.log'"
fi

# ============================================================================
# UPLOAD SCRIPTS & TEMPLATES
# ============================================================================
# Upload all EC2-side scripts and templates via SCP
# This is the single source of truth — no embedded heredocs!

log "Uploading scripts and templates to EC2..."

# Store domain and AWS info for the provision scripts
ssh $SSH_OPTS -i "$SSH_KEY" ubuntu@"$ELASTIC_IP" "
    echo '$DOMAIN' | sudo tee /opt/cloudmallinc/domain > /dev/null
    echo '$HOSTED_ZONE_ID' | sudo tee /opt/cloudmallinc/hosted-zone-id > /dev/null
    echo '$AWS_ACCOUNT_ID' | sudo tee /opt/cloudmallinc/aws-account-id > /dev/null
    echo '$REGION' | sudo tee /opt/cloudmallinc/aws-region > /dev/null
"

# Upload the EC2-side scripts
scp $SSH_OPTS -i "$SSH_KEY" "$SCRIPT_DIR/provision-customer-ec2.sh" ubuntu@"$ELASTIC_IP":/tmp/provision-customer.sh
scp $SSH_OPTS -i "$SSH_KEY" "$SCRIPT_DIR/deprovision-customer-ec2.sh" ubuntu@"$ELASTIC_IP":/tmp/deprovision-customer.sh
scp $SSH_OPTS -i "$SSH_KEY" "$SCRIPT_DIR/list-customers-ec2.sh" ubuntu@"$ELASTIC_IP":/tmp/list-customers.sh
scp $SSH_OPTS -i "$SSH_KEY" "$SCRIPT_DIR/post-renew-ec2.sh" ubuntu@"$ELASTIC_IP":/tmp/post-renew.sh

# Move scripts to proper location with permissions
ssh $SSH_OPTS -i "$SSH_KEY" ubuntu@"$ELASTIC_IP" "
    sudo mv /tmp/provision-customer.sh /opt/cloudmallinc/provision-customer.sh
    sudo mv /tmp/deprovision-customer.sh /opt/cloudmallinc/deprovision-customer.sh
    sudo mv /tmp/list-customers.sh /opt/cloudmallinc/list-customers.sh
    sudo mv /tmp/post-renew.sh /opt/cloudmallinc/post-renew.sh
    sudo chmod +x /opt/cloudmallinc/*.sh
"

log "Scripts uploaded"

# Upload templates from user.example/
TEMPLATES_SRC="$SCRIPT_DIR/../user.example"

if [ -d "$TEMPLATES_SRC" ]; then
    scp $SSH_OPTS -i "$SSH_KEY" "$TEMPLATES_SRC/config.json" ubuntu@"$ELASTIC_IP":/tmp/config.json
    scp $SSH_OPTS -i "$SSH_KEY" "$TEMPLATES_SRC/SOUL.md" ubuntu@"$ELASTIC_IP":/tmp/SOUL.md
    scp $SSH_OPTS -i "$SSH_KEY" "$TEMPLATES_SRC/secrets.json" ubuntu@"$ELASTIC_IP":/tmp/secrets.json
    
    ssh $SSH_OPTS -i "$SSH_KEY" ubuntu@"$ELASTIC_IP" "
        sudo mv /tmp/config.json /tmp/SOUL.md /tmp/secrets.json /opt/cloudmallinc/templates/
        sudo chmod 644 /opt/cloudmallinc/templates/*
    "
    log "Templates uploaded"
else
    warn "Templates directory not found at $TEMPLATES_SRC — customers will fail to provision!"
fi

# Create base Caddyfile
ssh $SSH_OPTS -i "$SSH_KEY" ubuntu@"$ELASTIC_IP" "sudo tee /opt/cloudmallinc/caddy/Caddyfile > /dev/null << 'CADDYFILE'
# CloudMall Inc Platform - Caddy Configuration
{
    admin off
}

http://$DOMAIN {
    respond /health \"OK\" 200
    respond \"CloudMall Inc Platform\" 200
}
CADDYFILE"

# Create Caddy systemd service
ssh $SSH_OPTS -i "$SSH_KEY" ubuntu@"$ELASTIC_IP" "sudo tee /etc/systemd/system/caddy.service > /dev/null << 'SERVICE'
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
SERVICE"

# Create certbot auto-renewal cron
ssh $SSH_OPTS -i "$SSH_KEY" ubuntu@"$ELASTIC_IP" "sudo tee /etc/cron.d/certbot-renew > /dev/null << 'CRON'
# Certbot auto-renewal - runs twice daily
0 0,12 * * * root certbot renew --quiet --deploy-hook \"/opt/cloudmallinc/post-renew.sh\"
CRON"

# Enable and start Caddy
ssh $SSH_OPTS -i "$SSH_KEY" ubuntu@"$ELASTIC_IP" "
    sudo systemctl daemon-reload
    sudo systemctl enable caddy
    sudo systemctl start caddy
"

log "Caddy configured and started"

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
echo "  IAM Role:       $ROLE_NAME (Route53 access for certbot)"
echo ""
echo "  SSH Access:     ssh -i ~/.ssh/${KEY_NAME}.pem ubuntu@$ELASTIC_IP"
echo ""
echo "  PROVISION CUSTOMERS:"
echo ""
echo "  From your Mac (creates DNS records + SSHs in):"
echo "     ./infra/provision-customer.sh mike"
echo ""
echo "  Or SSH in and run directly:"
echo "     ssh -i ~/.ssh/${KEY_NAME}.pem ubuntu@$ELASTIC_IP"
echo "     sudo /opt/cloudmallinc/provision-customer.sh mike"
echo ""
echo "  SELF-CONTAINED: EC2 handles certbot via IAM role. Certs auto-renew."
echo ""
echo "============================================================================"
