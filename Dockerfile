# Stage 1: Builder
FROM node:26-alpine AS builder

# Install build tools for native dependencies (e.g., bcrypt)
RUN apk add --no-cache python3 make g++

# Setup pnpm
RUN corepack enable && corepack prepare pnpm@10.33.1 --activate

WORKDIR /app

# Install dependencies first (caching layer)
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm prisma:generate
RUN pnpm build

# Stage 2: Runner
FROM node:26-alpine AS runner

# Install build tools for native dependencies in prod
RUN apk add --no-cache python3 make g++

# Setup pnpm
RUN corepack enable && corepack prepare pnpm@10.33.1 --activate

WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/
RUN pnpm install --frozen-lockfile --prod
RUN pnpm prisma:generate

# Copy compiled dist from builder
COPY --from=builder /app/dist ./dist

EXPOSE 5000

CMD ["pnpm", "start"]
