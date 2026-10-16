# Build the application and generate the Prisma client.
FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@10.33.1 --activate

WORKDIR /app

ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV SHADOW_DATABASE_URL="postgresql://build:build@localhost:5432/build_shadow"

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm prisma:generate
RUN pnpm build

# Install production dependencies separately.
FROM node:22-alpine AS production-deps

RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@10.33.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Run the compiled application without development dependencies.
FROM node:22-alpine AS runner

RUN apk add --no-cache libstdc++

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY prisma ./prisma/
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist

EXPOSE 5000

CMD ["node", "dist/index.js"]
