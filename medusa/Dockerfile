# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Install pnpm
RUN npm install -g pnpm@10.11.1

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
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

# Create non-root user
RUN addgroup -g 1001 -S medusa && adduser -S medusa -u 1001

# Add mode-aware healthcheck script
RUN printf '#!/bin/sh\n# Worker mode has no HTTP server - check node process instead\nif [ "${MEDUSA_WORKER_MODE}" = "worker" ]; then\n  pgrep -x node > /dev/null 2>&1\nelse\n  wget -q --spider http://127.0.0.1:9000/health\nfi\n' > /usr/local/bin/healthcheck.sh && chmod +x /usr/local/bin/healthcheck.sh

USER medusa

# Copy built application from builder
COPY --from=builder --chown=medusa:medusa /app/.medusa ./.medusa
COPY --from=builder --chown=medusa:medusa /app/package.json ./

# Install production deps in the server directory
WORKDIR /app/.medusa/server
RUN pnpm install --prod 2>/dev/null || npm install --omit=dev

# Debug: show build output and generated package.json
RUN echo "=== Build output ===" && ls -la /app/.medusa/server/ && \
    echo "=== package.json ===" && cat /app/.medusa/server/package.json && \
    echo "=== src/ ===" && ls -la /app/.medusa/server/src/ && \
    echo "--- Build output verified ---"

# Set production environment (critical: prevents CLI from trying to load ts-node)
ENV NODE_ENV=production

# Stay in .medusa/server — the CLI resolves @medusajs/medusa locally from here
WORKDIR /app/.medusa/server

# Mode-aware health check:
#  - server/shared → HTTP /health endpoint
#  - worker        → check node process is alive (no HTTP server in worker mode)
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=5 \
  CMD /usr/local/bin/healthcheck.sh

# Expose port
EXPOSE 9000

# Start the Medusa server
# Use npx from within .medusa/server where @medusajs/cli is installed
CMD ["npx", "medusa", "start"]

