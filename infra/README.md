# Infrastructure Scripts

AWS CLI scripts to spin up and tear down the platform infrastructure.

## Prerequisites

- AWS CLI installed and configured (`aws configure`)
- `jq` installed (`brew install jq`)
- A Route 53 hosted zone for your domain

## Usage

### Spin Up

```bash
./spinup.sh                           # Uses defaults (t3.small, cloudmallinc.com)
./spinup.sh --key-name my-key         # Use existing SSH key
./spinup.sh --instance-type t3.medium # Bigger instance
./spinup.sh --region us-west-2        # Different region
```

This creates:
- EC2 instance with Docker + Caddy pre-installed
- Security group (ports 22, 80, 443)
- Elastic IP (survives reboots)
- Route 53 DNS records (`*.yourdomain.com` + `yourdomain.com`)

### Post-Setup (one-time)

After spinup, SSH in and configure AWS credentials for Caddy's Let's Encrypt DNS challenge:

```bash
ssh -i ~/.ssh/cloudmallinc-key.pem ec2-user@<elastic-ip>
sudo vi /opt/cloudmallinc/caddy/.env   # Add your AWS creds
sudo systemctl start cloudmallinc-caddy
sudo systemctl enable cloudmallinc-caddy
```

### Adding Customer Containers

```bash
# On the EC2 instance
sudo /opt/cloudmallinc/add-customer.sh mike 3200
# Now mike.cloudmallinc.com routes to localhost:3200
```

### Tear Down

```bash
./teardown.sh           # Interactive confirmation
./teardown.sh --force   # No prompts, just destroy
```

Removes everything: EC2, Elastic IP, security group, DNS records.

## State File

`spinup.sh` creates `cloudmallinc-state.json` with all resource IDs. `teardown.sh` reads this to know what to delete. Don't lose this file!

## Cost Estimate

| Resource | Monthly Cost |
|----------|--------------|
| t3.small | ~$15 |
| Elastic IP (attached) | $0 |
| Route 53 zone | $0.50 |
| Data transfer | Variable |

**Total: ~$15-20/month** for the base platform.
