# ============================================================================
# Vito Docker Image
# 
# Multi-stage build:
# 1. Build stage: Compile TypeScript, build dashboard
# 2. Runtime stage: Slim Node.js image with only production deps
#
# Usage:
#   docker build -t cloudmallinc/vito:latest .
#   docker run -p 3000:3000 -v ./user:/app/user cloudmallinc/vito:latest
# ============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++ git

# Copy package files first (for better caching)
COPY package*.json ./
COPY dashboard/package*.json ./dashboard/

# Install all dependencies (including devDependencies for build)
RUN npm ci
RUN cd dashboard && npm ci

# Copy source files
COPY tsconfig.json ./
COPY src/ ./src/
COPY dashboard/ ./dashboard/

# Build TypeScript backend
RUN npm run build

# Build dashboard (Vite)
RUN cd dashboard && npm run build

# -----------------------------------------------------------------------------
# Stage 2: Runtime
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runtime

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache sqlite

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built assets from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dashboard/dist ./dashboard/dist

# Copy source skills (builtin skills that come with Vito)
COPY src/skills/builtin ./src/skills/builtin

# Create user directory structure (will be mounted in production)
RUN mkdir -p /app/user/logs /app/user/images /app/user/skills /app/user/apps

# Copy default user files (used as template for new customers)
COPY user.example/ ./user.example/

# Environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose the main port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start Vito server
CMD ["node", "dist/index.js"]
