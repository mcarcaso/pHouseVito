#!/usr/bin/env bash
set -euo pipefail

# ── spinup.sh ───────────────────────────────────────────────────────
# Provision a fresh EC2 instance for a single customer.
#
# Usage:  ./aws_deploy/spinup.sh <name> <domain>
# Example: ./aws_deploy/spinup.sh mike cloudmallinc.com
# ────────────────────────────────────────────────────────────────────

NAME="${1:?Usage: spinup.sh <name> <domain>}"
DOMAIN="${2:?Usage: spinup.sh <name> <domain>}"

# Prompt for OpenRouter API key (used by pi harness)
read -rp "OpenRouter API key: " OPENROUTER_API_KEY
[ -z "$OPENROUTER_API_KEY" ] && die "OpenRouter API key is required"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_DIR="$SCRIPT_DIR/state"
STATE_FILE="$STATE_DIR/$NAME.json"
KEY_NAME="vito-deploy"
KEY_PATH="$HOME/.ssh/${KEY_NAME}.pem"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
INSTANCE_TYPE="t3.small"
REPO_URL="https://github.com/mcarcaso/pHouseVito.git"
ROLE_NAME="vito-certbot-role"
PROFILE_NAME="vito-certbot-profile"

mkdir -p "$STATE_DIR"

# ── Helpers ─────────────────────────────────────────────────────────

log()  { echo -e "\033[1;34m→\033[0m $*"; }
ok()   { echo -e "\033[1;32m✓\033[0m $*"; }
die()  { echo -e "\033[1;31m✗\033[0m $*" >&2; exit 1; }

# ── 1. Pre-flight checks ───────────────────────────────────────────

log "Pre-flight checks …"
command -v aws >/dev/null || die "AWS CLI not found. Install: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html"
command -v jq  >/dev/null || die "jq not found. Install: brew install jq"
aws sts get-caller-identity >/dev/null 2>&1 || die "AWS credentials not configured. Run: aws configure"

if [ -f "$STATE_FILE" ]; then
  die "State file $STATE_FILE already exists. Tear down first or choose a different name."
fi

HOSTED_ZONE_ID=$(aws route53 list-hosted-zones-by-name \
  --dns-name "$DOMAIN." --max-items 1 \
  --query "HostedZones[?Name=='${DOMAIN}.'].Id" --output text | sed 's|/hostedzone/||')
[ -z "$HOSTED_ZONE_ID" ] && die "No hosted zone found for $DOMAIN"
ok "Hosted zone: $HOSTED_ZONE_ID"

# ── 2. SSH key ──────────────────────────────────────────────────────

if [ -f "$KEY_PATH" ]; then
  log "Reusing existing SSH key $KEY_PATH"
  # Make sure the key pair exists in AWS too
  if ! aws ec2 describe-key-pairs --key-names "$KEY_NAME" --region "$REGION" >/dev/null 2>&1; then
    log "Importing local key to AWS …"
    # Derive public key from private key and import
    PUB_KEY=$(ssh-keygen -y -f "$KEY_PATH")
    aws ec2 import-key-pair --key-name "$KEY_NAME" --public-key-material "$(echo "$PUB_KEY" | base64)" --region "$REGION" >/dev/null
  fi
else
  log "Creating SSH key pair …"
  aws ec2 create-key-pair --key-name "$KEY_NAME" --region "$REGION" \
    --query 'KeyMaterial' --output text > "$KEY_PATH"
  chmod 600 "$KEY_PATH"
fi
ok "SSH key: $KEY_PATH"

# ── 3. Security group ──────────────────────────────────────────────

SG_NAME="vito-${NAME}-sg"
log "Creating security group $SG_NAME …"

VPC_ID=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" \
  --region "$REGION" --query 'Vpcs[0].VpcId' --output text)

SG_ID=$(aws ec2 create-security-group \
  --group-name "$SG_NAME" \
  --description "Vito instance for $NAME" \
  --vpc-id "$VPC_ID" \
  --region "$REGION" \
  --query 'GroupId' --output text)

for PORT in 22 80 443; do
  aws ec2 authorize-security-group-ingress \
    --group-id "$SG_ID" --protocol tcp --port "$PORT" --cidr 0.0.0.0/0 \
    --region "$REGION" >/dev/null
done
ok "Security group: $SG_ID"

# ── 4. IAM role ─────────────────────────────────────────────────────

if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  log "Reusing existing IAM role $ROLE_NAME"
else
  log "Creating IAM role $ROLE_NAME …"
  aws iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{
      "Version":"2012-10-17",
      "Statement":[{
        "Effect":"Allow",
        "Principal":{"Service":"ec2.amazonaws.com"},
        "Action":"sts:AssumeRole"
      }]
    }' >/dev/null

  aws iam put-role-policy --role-name "$ROLE_NAME" \
    --policy-name "route53-certbot" \
    --policy-document '{
      "Version":"2012-10-17",
      "Statement":[{
        "Effect":"Allow",
        "Action":[
          "route53:ListHostedZones",
          "route53:GetChange",
          "route53:ChangeResourceRecordSets"
        ],
        "Resource":"*"
      }]
    }' >/dev/null
fi

if ! aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null
  aws iam add-role-to-instance-profile \
    --instance-profile-name "$PROFILE_NAME" --role-name "$ROLE_NAME" >/dev/null
  # IAM is eventually consistent — give it a moment
  log "Waiting for IAM profile propagation …"
  sleep 10
fi
ok "IAM role: $ROLE_NAME"

# ── 5. EC2 instance ────────────────────────────────────────────────

log "Looking up Ubuntu 22.04 AMI …"
AMI_ID=$(aws ec2 describe-images \
  --owners 099720109477 \
  --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*" \
             "Name=state,Values=available" \
  --region "$REGION" \
  --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text)
[ "$AMI_ID" = "None" ] && die "Could not find Ubuntu 22.04 AMI"
ok "AMI: $AMI_ID"

log "Launching $INSTANCE_TYPE instance …"
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --iam-instance-profile "Name=$PROFILE_NAME" \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3"}}]' \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=vito-$NAME}]" \
  --region "$REGION" \
  --query 'Instances[0].InstanceId' --output text)

log "Waiting for instance $INSTANCE_ID to be running …"
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"
ok "Instance: $INSTANCE_ID"

# ── 6. Elastic IP ──────────────────────────────────────────────────

log "Allocating Elastic IP …"
EIP_JSON=$(aws ec2 allocate-address --domain vpc --region "$REGION")
ALLOCATION_ID=$(echo "$EIP_JSON" | jq -r '.AllocationId')
ELASTIC_IP=$(echo "$EIP_JSON" | jq -r '.PublicIp')

aws ec2 associate-address \
  --instance-id "$INSTANCE_ID" --allocation-id "$ALLOCATION_ID" \
  --region "$REGION" >/dev/null
ok "Elastic IP: $ELASTIC_IP"

# ── 7. Route53 ─────────────────────────────────────────────────────

log "Creating DNS records …"
DNS_CHANGE_ID=$(aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" \
  --change-batch "{
    \"Changes\": [
      {
        \"Action\": \"UPSERT\",
        \"ResourceRecordSet\": {
          \"Name\": \"${NAME}.${DOMAIN}\",
          \"Type\": \"A\",
          \"TTL\": 300,
          \"ResourceRecords\": [{\"Value\": \"$ELASTIC_IP\"}]
        }
      },
      {
        \"Action\": \"UPSERT\",
        \"ResourceRecordSet\": {
          \"Name\": \"*.${NAME}.${DOMAIN}\",
          \"Type\": \"A\",
          \"TTL\": 300,
          \"ResourceRecords\": [{\"Value\": \"$ELASTIC_IP\"}]
        }
      }
    ]
  }" --query 'ChangeInfo.Id' --output text)
ok "DNS: ${NAME}.${DOMAIN} + *.${NAME}.${DOMAIN} → $ELASTIC_IP"

log "Waiting for DNS propagation …"
aws route53 wait resource-record-sets-changed --id "$DNS_CHANGE_ID"
ok "DNS propagated"

# ── 8. Wait for SSH ────────────────────────────────────────────────

log "Waiting for SSH …"
SSH_OPTS="-i $KEY_PATH -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -o LogLevel=ERROR"
for i in $(seq 1 60); do
  if ssh $SSH_OPTS "ubuntu@$ELASTIC_IP" true 2>/dev/null; then
    break
  fi
  [ "$i" = "60" ] && die "SSH never became reachable"
  sleep 5
done
ok "SSH reachable"

# ── Save state early ────────────────────────────────────────────────
# Infrastructure is created — save state now so teardown works even if remote setup fails.

cat > "$STATE_FILE" << EOF
{
  "name": "$NAME",
  "domain": "$DOMAIN",
  "instance_id": "$INSTANCE_ID",
  "elastic_ip": "$ELASTIC_IP",
  "allocation_id": "$ALLOCATION_ID",
  "security_group_id": "$SG_ID",
  "key_name": "$KEY_NAME",
  "region": "$REGION",
  "hosted_zone_id": "$HOSTED_ZONE_ID",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
ok "State saved to $STATE_FILE"

# ── 9. Remote setup ────────────────────────────────────────────────

log "Running remote setup (this takes a few minutes) …"

ssh $SSH_OPTS "ubuntu@$ELASTIC_IP" bash -s "$NAME" "$DOMAIN" "$REPO_URL" "$OPENROUTER_API_KEY" << 'REMOTE_SCRIPT'
set -euo pipefail
NAME="$1"
DOMAIN="$2"
REPO_URL="$3"
OPENROUTER_API_KEY="$4"
FQDN="${NAME}.${DOMAIN}"

export DEBIAN_FRONTEND=noninteractive

echo ">>> Installing system packages …"
sudo apt-get update -qq
sudo apt-get install -y -qq git sqlite3 python3 python3-pip build-essential curl jq

echo ">>> Installing Node.js 20 …"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y -qq nodejs
NODE_PATH=$(which node)
echo "Node: $(node --version) at $NODE_PATH"

echo ">>> Installing PM2 …"
sudo npm install -g pm2

echo ">>> Installing Caddy …"
sudo apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo apt-get update -qq
sudo apt-get install -y -qq caddy

echo ">>> Installing certbot with Route53 plugin …"
sudo pip3 install certbot certbot-dns-route53

echo ">>> Cloning repo …"
sudo git clone -b main "$REPO_URL" /opt/vito
sudo chown -R ubuntu:ubuntu /opt/vito
cd /opt/vito

echo ">>> Building Vito …"
npm ci
cd dashboard && npm ci && npm run build && cd ..
npm run build

echo ">>> Setting up user directory …"
cp -r user.example/* user/ 2>/dev/null || cp -r user.example/. user/

echo ">>> Configuring vito.config.json …"
node -e "
  const fs = require('fs');
  const p = 'user/vito.config.json';
  const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'));
  cfg.apps = { ...cfg.apps, baseDomain: '$FQDN' };
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
"

echo ">>> Writing secrets …"
node -e "
  const fs = require('fs');
  const p = 'user/secrets.json';
  const secrets = JSON.parse(fs.readFileSync(p, 'utf-8'));
  secrets.OPENROUTER_API_KEY = '$OPENROUTER_API_KEY';
  fs.writeFileSync(p, JSON.stringify(secrets, null, 2) + '\n');
"

echo ">>> Generating ecosystem.config.cjs …"
cat > user/ecosystem.config.cjs << ECOEOF
module.exports = {
  apps: [
    {
      name: 'vito-server',
      script: './node_modules/.bin/tsx',
      args: 'src/index.ts',
      interpreter: '$NODE_PATH',
      cwd: '/opt/vito',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: '3030',
        CUSTOMER_NAME: '$NAME',
      },
      error_file: 'user/logs/pm2-error.log',
      out_file: 'user/logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
  ],
};
ECOEOF

mkdir -p user/logs

echo ">>> Obtaining wildcard TLS certificate …"
sudo certbot certonly --dns-route53 \
  -d "$FQDN" -d "*.$FQDN" \
  --non-interactive --agree-tos --register-unsafely-without-email

echo ">>> Writing Caddyfile …"
CERT_DIR="/etc/letsencrypt/live/$FQDN"
sudo tee /etc/caddy/Caddyfile > /dev/null << CADDYEOF
$FQDN, *.$FQDN {
  tls $CERT_DIR/fullchain.pem $CERT_DIR/privkey.pem
  reverse_proxy localhost:3030
}
CADDYEOF

echo ">>> Giving Caddy access to certs …"
sudo chmod 755 /etc/letsencrypt/live /etc/letsencrypt/archive
sudo chmod 644 /etc/letsencrypt/archive/$FQDN/fullchain*.pem
sudo chmod 644 /etc/letsencrypt/archive/$FQDN/privkey*.pem

echo ">>> Starting Caddy …"
sudo systemctl restart caddy
sudo systemctl enable caddy

echo ">>> Starting Vito via PM2 …"
cd /opt/vito
pm2 start user/ecosystem.config.cjs
pm2 save

# Non-critical: pm2 startup and certbot cron — don't let these kill the script
set +e
sudo env PATH=$PATH:$(dirname $(which pm2)) pm2 startup systemd -u ubuntu --hp /home/ubuntu 2>/dev/null
echo "0 3 * * * /usr/local/bin/certbot renew --quiet --post-hook 'systemctl restart caddy'" | sudo crontab -
set -e

echo ">>> Done!"
REMOTE_SCRIPT

ok "Remote setup complete"

# ── 10. Summary ─────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Instance ready!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Dashboard:  https://${NAME}.${DOMAIN}"
echo " IP:         $ELASTIC_IP"
echo " SSH:        ssh -i $KEY_PATH ubuntu@$ELASTIC_IP"
echo " Deploy:     ./aws_deploy/deploy.sh $NAME"
echo " Teardown:   ./aws_deploy/teardown.sh $NAME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
