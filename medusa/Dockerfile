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
RUN apk add --no-cache python3 wget

# Install pnpm for production
RUN npm install -g pnpm@10.11.1

# Create non-root user
RUN addgroup -g 1001 -S medusa && adduser -S medusa -u 1001
USER medusa

# Copy built application from builder
COPY --from=builder --chown=medusa:medusa /app/.medusa ./.medusa
COPY --from=builder --chown=medusa:medusa /app/package.json ./

# Install production deps in the server directory
WORKDIR /app/.medusa/server
RUN pnpm install --prod 2>/dev/null || npm install --omit=dev

# Verify build output exists
RUN ls -la /app/.medusa/server/ && echo "--- Build output verified ---"

# Switch back to project root for medusa start
# (medusa start expects CWD to be project root, looks for .medusa/server/ relative to it)
WORKDIR /app

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:9000/health || exit 1

# Expose port
EXPOSE 9000

# Start using the medusa CLI (installed in .medusa/server/node_modules)
CMD [".medusa/server/node_modules/.bin/medusa", "start"]
