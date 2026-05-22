# Build stage
FROM node:20-alpine AS builder

WORKDIR /app/medusa

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy all source
COPY . .

# Remove any existing node_modules
RUN rm -rf node_modules

# Install dependencies
RUN yarn install --immutable 2>/dev/null || yarn install

# Build the application
RUN yarn build

# Production stage
FROM node:20-alpine

WORKDIR /app/medusa

# Install runtime dependencies
RUN apk add --no-cache python3

# Create .medusa directory
RUN mkdir -p .medusa

# Copy built application from builder
COPY --from=builder /app/medusa/.medusa ./.medusa

# Install production deps in the server directory
WORKDIR /app/medusa/.medusa/server
RUN yarn install --production 2>/dev/null || yarn install --production

# Health check - CRITICAL: use 127.0.0.1 not localhost (Alpine resolves localhost to ::1 IPv6 first)
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:9000/health || exit 1

# Expose port
EXPOSE 9000

# Start command - migrations run automatically on first start
CMD ["yarn", "start"]