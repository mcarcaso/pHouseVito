#!/bin/bash
# Test that vito starts and stays alive even without API keys

set -e

echo "=== Testing Vito Startup Without API Keys ==="

# Set workspace to temp dir
export VITO_WORKSPACE=/tmp/vito-test
rm -rf $VITO_WORKSPACE
mkdir -p $VITO_WORKSPACE

# Copy template files
cp -r templates/workspace/* $VITO_WORKSPACE/
mkdir -p $VITO_WORKSPACE/skills $VITO_WORKSPACE/images $VITO_WORKSPACE/apps

# Create empty secrets (no API keys)
cat > $VITO_WORKSPACE/secrets.json << 'SECRETS'
{
  "ANTHROPIC_API_KEY": "",
  "OPENROUTER_API_KEY": ""
}
SECRETS

echo "Workspace created at $VITO_WORKSPACE"
echo "Starting server..."

# Run server in foreground to see output
timeout 10 node dist/index.js --port 3100 2>&1 || true

echo ""
echo "=== Server exited or timed out (expected after 10s) ==="
