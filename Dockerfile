FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --production=false

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

RUN addgroup --system --gid 1001 syncengine && \
    adduser --system --uid 1001 syncengine

COPY package.json package-lock.json* ./
RUN npm ci --production && npm cache clean --force

COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/data/wal /app/data/snapshots && \
    chown -R syncengine:syncengine /app/data

USER syncengine

ENV NODE_ENV=production
ENV SYNC_DATA_DIR=/app/data
ENV SYNC_WAL_PATH=/app/data/wal
ENV SYNC_SNAPSHOT_PATH=/app/data/snapshots

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/health || exit 1

CMD ["node", "dist/index.js"]
