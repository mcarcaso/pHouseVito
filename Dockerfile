FROM node:20-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git sqlite3 wget \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g pm2 serve

COPY . .
RUN npm ci
RUN cd dashboard && npm ci
RUN npm run build
RUN cd dashboard && npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "dist/index.js"]
