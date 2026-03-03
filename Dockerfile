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

# Link globally to simulate npm install -g
RUN npm link

# Create a test user
RUN useradd -m testuser
USER testuser
WORKDIR /home/testuser

# Test the CLI
CMD ["bash", "-c", "vito init && cat ~/vito/profile.json && echo '=== INIT SUCCESS ===' && vito start && sleep 2 && vito status && vito stop && echo '=== ALL TESTS PASSED ==='"]
