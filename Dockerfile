FROM node:20-slim

WORKDIR /app

# Copy everything
COPY . .

# Install root dependencies
RUN npm install

# Install dashboard dependencies
RUN cd dashboard && npm install

# Build TypeScript and dashboard
RUN npm run build

# Verify dashboard build exists
RUN ls -la dashboard/dist/ && test -f dashboard/dist/index.html

# Copy built-in skills to where the package expects them (/app/skills/)
RUN cp -r src/skills/builtin skills && ls -la skills/

# Link globally to simulate npm install -g
RUN npm link

# Expose ports: 3200 for dashboard, 3100-3199 for apps
EXPOSE 3200
EXPOSE 3100-3199

# Run as root for full permissions
WORKDIR /root

# Environment variables (can be overridden at runtime)
ENV AI_BASE_DOMAIN=""
ENV PROXY_PORT=""

# Default: init workspace then start server on port 3200
CMD ["sh", "-c", "ai init && ai start --foreground --port 3200"]
