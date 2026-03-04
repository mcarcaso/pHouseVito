#!/bin/bash
set -e

# ============================================================================
# Build Vito Docker Image
#
# This builds the full Vito image from the vito3.0 source.
# Run this before deploying, or set up CI to build automatically.
#
# Usage: 
#   ./build-vito-image.sh                    # Build locally
#   ./build-vito-image.sh --push             # Build and push to registry
#   ./build-vito-image.sh --platform linux   # Build for Linux (EC2)
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VITO_SOURCE="${VITO_SOURCE:-$HOME/vito3.0}"
IMAGE_NAME="${IMAGE_NAME:-cloudmallinc/vito}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
PUSH=false
PLATFORM=""

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

log "Building Vito image from: $VITO_SOURCE"
log "Image: $IMAGE_NAME:$IMAGE_TAG"

# Copy Dockerfile to Vito source (needs to be in build context)
cp "$SCRIPT_DIR/../Dockerfile" "$VITO_SOURCE/Dockerfile"

# Build
cd "$VITO_SOURCE"
docker build $PLATFORM -t "$IMAGE_NAME:$IMAGE_TAG" .

log "Image built: $IMAGE_NAME:$IMAGE_TAG"

# Clean up
rm -f "$VITO_SOURCE/Dockerfile"

# Push if requested
if [ "$PUSH" = true ]; then
    log "Pushing to registry..."
    docker push "$IMAGE_NAME:$IMAGE_TAG"
    log "Pushed: $IMAGE_NAME:$IMAGE_TAG"
fi

# Show size
SIZE=$(docker images "$IMAGE_NAME:$IMAGE_TAG" --format "{{.Size}}")
log "Image size: $SIZE"

echo ""
echo "=============================================="
echo "  Vito image ready: $IMAGE_NAME:$IMAGE_TAG"
echo "=============================================="
echo ""
echo "  To test locally:"
echo "    docker run -p 3030:3000 -v \$(pwd)/user:/app/user $IMAGE_NAME:$IMAGE_TAG"
echo ""
echo "  To push to registry:"
echo "    docker push $IMAGE_NAME:$IMAGE_TAG"
echo ""
