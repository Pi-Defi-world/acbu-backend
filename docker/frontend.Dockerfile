# Multi-stage Dockerfile for the ACBU Next.js frontend.
#
# Build context MUST be the frontend directory (see the `frontend` service in
# docker-compose.yml):
#
#   docker build -f docker/frontend.Dockerfile acbu-frontend
#   docker compose --profile frontend up -d --build
#
# Requires the frontend to be checked out at ./acbu-frontend and its
# next.config.(js|ts|mts) to set `output: "standalone"` (used by stage 3).

# Stage 1: Dependencies
FROM node:22-alpine AS deps

RUN corepack enable && corepack prepare pnpm@10.33.1 --activate

WORKDIR /app

# Install dependencies first (caching layer)
COPY package.json ./
COPY pnpm-lock.yaml* ./
RUN pnpm install --no-frozen-lockfile

# Stage 2: Builder
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.33.1 --activate

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm build

# Stage 3: Runner
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -g 1001 -S nodejs \
  && adduser -S nextjs -u 1001

# `output: "standalone"` produces .next/standalone with a minimal server.js
# that bundles only the required node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
