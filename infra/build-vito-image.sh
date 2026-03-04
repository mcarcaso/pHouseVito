#!/bin/bash
set -e

# ============================================================================
# Build Vito Docker Image
#
# This builds the full Vito image from the vito3.0 source and pushes to ECR.
#
# Usage: 
#   ./build-vito-image.sh                    # Build locally
#   ./build-vito-image.sh --push             # Build and push to ECR
#   ./build-vito-image.sh --platform linux   # Build for Linux (EC2)
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VITO_SOURCE="${VITO_SOURCE:-$REPO_ROOT}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
PUSH=false
PLATFORM=""

# AWS ECR Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")
ECR_REPO_NAME="cloudmallinc/vito"

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --push) PUSH=true; shift ;;
        --platform)
            PLATFORM="--platform linux/amd64"
            shift ;;
        --tag)
            IMAGE_TAG="$2"
            shift 2 ;;
        --source)
            VITO_SOURCE="$2"
            shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# Validation
if [ ! -d "$VITO_SOURCE" ]; then
    error "Vito source directory not found: $VITO_SOURCE"
fi

if [ ! -f "$VITO_SOURCE/package.json" ]; then
    error "Not a valid Vito directory (no package.json): $VITO_SOURCE"
fi

if [ -z "$AWS_ACCOUNT_ID" ]; then
    error "Could not get AWS account ID. Make sure AWS CLI is configured."
fi

ECR_REGISTRY="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
ECR_IMAGE="$ECR_REGISTRY/$ECR_REPO_NAME"

log "Building Vito image from: $VITO_SOURCE"
log "ECR Registry: $ECR_REGISTRY"
log "Image: $ECR_REPO_NAME:$IMAGE_TAG"

# Create ECR repo if it doesn't exist
if ! aws ecr describe-repositories --repository-names "$ECR_REPO_NAME" --region "$AWS_REGION" >/dev/null 2>&1; then
    log "Creating ECR repository: $ECR_REPO_NAME"
    aws ecr create-repository \
        --repository-name "$ECR_REPO_NAME" \
        --region "$AWS_REGION" \
        --image-scanning-configuration scanOnPush=false \
        --encryption-configuration encryptionType=AES256 >/dev/null
fi

# Copy Dockerfile to Vito source (needs to be in build context)
# Skip if source and dest are the same file
DOCKERFILE_SRC="$(cd "$SCRIPT_DIR/.." && pwd)/Dockerfile"
DOCKERFILE_DST="$VITO_SOURCE/Dockerfile"
if [ "$DOCKERFILE_SRC" != "$DOCKERFILE_DST" ]; then
    cp "$DOCKERFILE_SRC" "$DOCKERFILE_DST"
fi

# Build
cd "$VITO_SOURCE"
log "Building Docker image..."
docker build $PLATFORM -t "$ECR_REPO_NAME:$IMAGE_TAG" -t "$ECR_IMAGE:$IMAGE_TAG" .

log "Image built: $ECR_REPO_NAME:$IMAGE_TAG"

# Clean up
rm -f "$VITO_SOURCE/Dockerfile"

# Push if requested
if [ "$PUSH" = true ]; then
    log "Logging into ECR..."
    aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"
    
    log "Pushing to ECR..."
    docker push "$ECR_IMAGE:$IMAGE_TAG"
    log "Pushed: $ECR_IMAGE:$IMAGE_TAG"
fi

# Show size
SIZE=$(docker images "$ECR_REPO_NAME:$IMAGE_TAG" --format "{{.Size}}")
log "Image size: $SIZE"

echo ""
echo "=============================================="
echo "  Vito image ready"
echo "=============================================="
echo ""
echo "  Local:  $ECR_REPO_NAME:$IMAGE_TAG"
echo "  ECR:    $ECR_IMAGE:$IMAGE_TAG"
echo ""
if [ "$PUSH" = false ]; then
echo "  To push to ECR:"
echo "    ./build-vito-image.sh --push --platform linux"
echo ""
fi
echo "  To test locally:"
echo "    docker run -p 3030:3000 -v \$(pwd)/user:/app/user $ECR_REPO_NAME:$IMAGE_TAG"
echo ""
