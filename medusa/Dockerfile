# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Install pnpm
RUN npm install -g pnpm@10.11.1

# Copy package files and patches (patches must exist before pnpm install)
COPY package.json pnpm-lock.yaml* ./
COPY patches/ ./patches/

# Install dependencies (pnpm.patchedDependencies in package.json applies patches automatically)
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Copy source
COPY . .

# Build the application
RUN pnpm build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache python3 wget curl

# Install pnpm for production
RUN npm install -g pnpm@10.11.1

# Create non-root user and give ownership of app dir
RUN addgroup -g 1001 -S medusa && adduser -S medusa -u 1001

# Add mode-aware healthcheck script
RUN printf '#!/bin/sh\n# Worker mode has no HTTP server - check node process instead\nif [ "${MEDUSA_WORKER_MODE}" = "worker" ]; then\n  pgrep -x node > /dev/null 2>&1\nelse\n  wget -q --spider http://127.0.0.1:9000/health\nfi\n' > /usr/local/bin/healthcheck.sh && chmod +x /usr/local/bin/healthcheck.sh

# Copy built application from builder (as root, chown to medusa)
COPY --from=builder --chown=medusa:medusa /app/.medusa ./.medusa
COPY --from=builder --chown=medusa:medusa /app/package.json ./

# Copy startup diagnostic script
COPY --chown=medusa:medusa start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Switch to the server directory
WORKDIR /app/.medusa/server

# Copy patches so pnpm can resolve patchedDependencies
COPY --from=builder /app/patches/ ./patches/

# Create ALL writable directories needed by medusa user:
# - /home/medusa/.config    → pnpm config storage
# - /home/medusa/.npm       → npm cache, logs
# - /app/.pnpm-store        → pnpm package store
# - /app/.medusa/server/.cache → medusa cache
RUN mkdir -p /home/medusa/.config /home/medusa/.npm /app/.medusa/server/.cache /app/.pnpm-store \
    && chown -R medusa:medusa /home/medusa /app/.medusa/server/.cache /app/.medusa/server /app/.pnpm-store

# Switch to medusa BEFORE pnpm install so node_modules is owned by medusa
USER medusa

# Set pnpm store via env var (avoids needing writable .config at this point)
ENV PNPM_STORE_DIR=/app/.pnpm-store

# Production deps install as medusa user
RUN pnpm install --prod --store-dir /app/.pnpm-store 2>/dev/null || npm install --omit=dev

# Set production environment (critical: prevents CLI from trying to load ts-node)
ENV NODE_ENV=production

# Stay in .medusa/server — the CLI resolves @medusajs/medusa locally from here
WORKDIR /app/.medusa/server

# Mode-aware health check:
#  - server/shared → HTTP /health endpoint
#  - worker        → check node process is alive (no HTTP server in worker mode)
# start-period=60s: worker passes instantly (pgrep), server needs ~45s to boot
HEALTHCHECK --interval=15s --timeout=10s --start-period=60s --retries=5 \
  CMD /usr/local/bin/healthcheck.sh

# Expose port
EXPOSE 9000

# Start the Medusa server via diagnostic wrapper script
CMD ["/app/start.sh"]
