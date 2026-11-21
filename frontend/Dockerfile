# syntax=docker/dockerfile:1.7

# ─── Base ────────────────────────────────────────────────────────────────
# AX-015: digest-pin the base image so builds are reproducible and the
# origin of every layer is auditable. The tag updates at a known cadence;
# bump the digest deliberately, never float the tag.
#
# node:24-alpine (manifest list digest, 2026-09-23) — matches .nvmrc (24).
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base

ENV PNPM_VERSION=10.15.0 \
    PNPM_HOME=/pnpm \
    NPM_CONFIG_CACHE=/pnpm/cache

ENV PATH="$PNPM_HOME:$PATH"

# ─── deps ────────────────────────────────────────────────────────────────
# Install production + dev deps from the frozen lockfile into a standalone
# layer so it can be cached and reused by the builder.
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN npm install -g "pnpm@${PNPM_VERSION}" \
    # .npmrc carries a Windows-only store-dir (E:\) – override for Linux.
    && pnpm install --frozen-lockfile --store-dir=/pnpm/store

# ─── builder ─────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_BILLS_ENABLED
ARG NEXT_PUBLIC_STELLAR_NETWORK=TESTNET
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_BILLS_ENABLED=$NEXT_PUBLIC_BILLS_ENABLED \
    NEXT_PUBLIC_STELLAR_NETWORK=$NEXT_PUBLIC_STELLAR_NETWORK \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm install -g "pnpm@${PNPM_VERSION}" \
    && pnpm build

# ─── runner ──────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# The standalone build emits this server (see .next/standalone/server.js).
CMD ["node", "server.js"]