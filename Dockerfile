# Multi-stage production build for Creem Platform (Bun)
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy package manifest and strict Bun lockfile
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy application source
COPY . .

# Build Vite client and server bundle
RUN bun run build

# Production runner stage
FROM oven/bun:1-alpine AS runner

WORKDIR /app

ENV APP_ENV=production
ENV NODE_ENV=production
ENV APP_MODE=production
ENV PORT=3000

# Install curl for container healthcheck
RUN apk add --no-cache curl

# Install production dependencies using strict lockfile
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy compiled build artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/metadata.json ./metadata.json

# Security: switch to non-root user
RUN chown -R bun:bun /app
USER bun

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD sh -c 'curl -f http://localhost:${PORT:-3000}/health || exit 1'

CMD ["bun", "run", "dist/server.cjs"]
