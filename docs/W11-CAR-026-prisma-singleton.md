# W11-CAR-026 — Prisma Shared Singleton Policy

## Problem

Several controllers previously instantiated `new PrismaClient()` directly instead of importing
the shared singleton from `src/config/database.ts`. Standalone instances bypass:

- **Database query auditing** — OpenTelemetry span-per-query tracing applied by the singleton's
  Prisma extension.
- **Connection pool limits** — the pool size (configurable via `DB_CONNECTION_LIMIT`) and the
  P2024 retry-on-exhaustion logic are only applied to the singleton.
- **Tenant isolation middleware** — any future row-level tenant middleware attached to the
  singleton would be silently skipped by standalone clients.

## Rule

> **Never call `new PrismaClient()` outside `src/config/database.ts`.**

This is enforced at lint time by the `no-restricted-syntax` ESLint rule in `.eslintrc.json`.
Any attempt to instantiate `PrismaClient` directly in a file other than the singleton factory
will produce a lint error and fail CI.

## Correct usage

```typescript
// ✅ Import the shared singleton
import { prisma } from "../../config/database";

// Use it directly
const user = await prisma.user.findUnique({ where: { id } });
```

```typescript
// ❌ Never do this
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient(); // lint error — W11-CAR-026
```

If you need a read replica, import `prismaReplica`:

```typescript
import { prismaReplica } from "../../config/database";
```

## Singleton location

`src/config/database.ts` exports:
- `prisma` — primary write client (direct or Prisma Accelerate, depending on env).
- `prismaReplica` — read-replica client (falls back to primary when no replica is configured).
- `connectWithRetry()` — called at startup to establish the initial connection with exponential
  back-off and full jitter.

## References

- Audit finding: W11-CAR-026 (carried from BE#570)
- Closes GitHub issue #1379
