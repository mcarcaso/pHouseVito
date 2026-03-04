# CloudMall Inc Infrastructure

Multi-tenant whitelabel platform infrastructure using EC2 + Caddy + Docker.

## Architecture

```
                        YOUR MACHINE (AWS creds here)
                                    │
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
            ▼                       ▼                       ▼
    provision-customer.sh    renew-certs.sh       deprovision-customer.sh
            │                       │                       │
            └───────────────────────┼───────────────────────┘
                                    │
                          Route53 + certbot
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           EC2 INSTANCE                                   │
│                     (NO AWS CREDS HERE)                                  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Caddy (reverse proxy)                                              │ │
│  │  - Loads certs from /opt/cloudmallinc/certs/                        │ │
│  │  - Routes *.mike.cloudmallinc.com → localhost:4001                  │ │
│  │  - Routes *.joe.cloudmallinc.com → localhost:4002                   │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                              │                                           │
│         ┌────────────────────┼────────────────────┐                     │
│         ▼                    ▼                    ▼                     │
│  ┌────────────┐      ┌────────────┐      ┌────────────┐                │
│  │ Mike's     │      │ Joe's      │      │ Jane's     │                │
│  │ Container  │      │ Container  │      │ Container  │                │
│  │ :4001      │      │ :4002      │      │ :4003      │                │
│  │            │      │            │      │            │                │
│  │ Apps:      │      │ Apps:      │      │ Apps:      │                │
│  │ app1.mike  │      │ app1.joe   │      │ app1.jane  │                │
│  │ app2.mike  │      │ app2.joe   │      │ app2.jane  │                │
│  └────────────┘      └────────────┘      └────────────┘                │
└─────────────────────────────────────────────────────────────────────────┘
```

## How It Works

### SSL Certificates (Wildcard per Customer)

Each customer gets **one wildcard certificate** that covers ALL their subdomains:

| Customer | Certificate | Covers |
|----------|-------------|--------|
| Mike | `*.mike.cloudmallinc.com` | `mike.cloudmallinc.com`, `app1.mike.cloudmallinc.com`, `app2.mike.cloudmallinc.com`, etc. |
| Joe | `*.joe.cloudmallinc.com` | `joe.cloudmallinc.com`, `app1.joe.cloudmallinc.com`, `app2.joe.cloudmallinc.com`, etc. |

**One cert per customer = infinite apps per customer.**

Wildcard certs require DNS challenge (not HTTP challenge), which is why certbot runs on YOUR machine with AWS creds — not on the EC2 instance.

### Rate Limits

Let's Encrypt allows **50 certificates per week per registered domain**.

Since we use one wildcard cert per customer (not per app):
- **50 certs/week = 50 new customers/week**
- Each customer can deploy unlimited apps (already covered by their wildcard)

This is plenty of headroom for growth.

## Prerequisites

### On Your Machine

```bash
# AWS CLI configured with Route53 permissions
aws configure

# Certbot with Route53 plugin
brew install certbot  # macOS
pip install certbot-dns-route53

# jq for JSON parsing
brew install jq
```

### Required AWS Permissions

The AWS credentials on your machine need:
- `route53:ListHostedZones`
- `route53:GetChange`
- `route53:ChangeResourceRecordSets`
- `ec2:*` (for spinup/teardown)

## Setup

### 1. Spin Up Infrastructure

```bash
./spinup.sh
```

This creates:
- EC2 instance (Ubuntu 22.04, t3.small)
- Elastic IP
- Security group (ports 22, 80, 443)
- Route53 records: `cloudmallinc.com` and `*.cloudmallinc.com` → EC2 IP

### 2. Configure the EC2 Instance

```bash
# SCP the setup script
scp -i ~/.ssh/cloudmallinc-key.pem setup.sh ubuntu@<elastic-ip>:~/

# SSH in
ssh -i ~/.ssh/cloudmallinc-key.pem ubuntu@<elastic-ip>

# Run setup
sudo ./setup.sh
```

### 3. Provision a Customer

```bash
./provision-customer.sh mike
```

This:
1. Creates Route53 record: `*.mike.cloudmallinc.com` → EC2 IP
2. Runs certbot (on your machine) with DNS challenge
3. Uploads the wildcard cert to EC2
4. Starts the customer's Docker container
5. Updates Caddy config to route traffic

Customer is now live at:
- `https://mike.cloudmallinc.com` (dashboard)
- `https://myapp.mike.cloudmallinc.com` (their apps)

## Daily Operations

### Add a Customer

```bash
./provision-customer.sh <name> [port]
```

### Remove a Customer

```bash
./deprovision-customer.sh <name>
```

### Renew Certificates

Certs expire every 90 days. Run this monthly:

```bash
# Renew all customers
./renew-certs.sh

# Renew specific customer
./renew-certs.sh mike
```

### List Customers

```bash
# Local state
cat customers.json | jq

# On EC2
ssh -i ~/.ssh/cloudmallinc-key.pem ubuntu@<ip> /opt/cloudmallinc/list-customers.sh
```

## Teardown

```bash
./teardown.sh
```

This destroys:
- EC2 instance
- Elastic IP
- Security group
- Route53 records

Customer DNS records are also cleaned up.

## Cost Estimate

| Resource | Monthly Cost |
|----------|--------------|
| EC2 t3.small | ~$15 |
| Elastic IP (attached) | $0 |
| Route53 hosted zone | $0.50 |
| Route53 queries | ~$0.40/million |
| **Total** | **~$16/month** |

## Directory Structure

### On Your Machine (`infra/`)

```
infra/
├── spinup.sh              # Create EC2 + Route53 + security group
├── teardown.sh            # Destroy everything
├── setup.sh               # SCP to EC2 and run to configure
├── provision-customer.sh  # Add a customer
├── deprovision-customer.sh # Remove a customer
├── renew-certs.sh         # Renew SSL certs
├── cloudmallinc-state.json # Created by spinup.sh
└── customers.json         # Local customer registry
```

### On EC2 (`/opt/cloudmallinc/`)

```
/opt/cloudmallinc/
├── caddy/
│   ├── Caddyfile          # Caddy config (auto-managed)
│   └── customers.json     # Customer registry
├── certs/
│   └── <customer>/
│       ├── fullchain.pem
│       └── privkey.pem
├── containers/
│   └── <customer>/
│       ├── docker-compose.yml
│       └── data/
└── list-customers.sh      # Helper script
```
