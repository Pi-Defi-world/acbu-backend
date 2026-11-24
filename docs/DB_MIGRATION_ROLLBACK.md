# Database Migration Rollback Runbook

This runbook defines the procedures and automated tooling for safely rolling back database migrations in `acbu-backend`.

---

## 1. Overview

Prisma Migrate natively tracks forward migrations in `_prisma_migrations`. To protect production and staging environments against flawed or broken schema changes, every migration in `prisma/migrations/` includes:
1. `migration.sql`: Forward DDL applied during `prisma migrate deploy`.
2. `down.sql`: Reversal DDL executed during rollback.

The automated rollback utility is located at `scripts/db-rollback.ts` and wired to npm commands.

---

## 2. Running a Rollback

### Step 1: Preview Rollback (Dry-Run)
Before applying any change to an active database, preview the rollback SQL that will be executed:
```bash
pnpm run prisma:rollback --dry-run
```

### Step 2: Roll Back the Latest Migration
To revert the most recently applied migration on the active database (`DATABASE_URL`):
```bash
pnpm run prisma:rollback
```

### Step 3: Roll Back Multiple Migrations
To roll back the last `N` migrations:
```bash
pnpm run prisma:rollback --steps=2
```

### Step 4: Roll Back a Specific Migration Target
To target an exact migration folder name:
```bash
pnpm run prisma:rollback --target=20260924000000_fix_local_amount_precision
```

---

## 3. What the Rollback Script Does

When `pnpm run prisma:rollback` executes:
1. Queries `_prisma_migrations` for applied migrations where `rolled_back_at IS NULL`.
2. Locates the matching `down.sql` in `prisma/migrations/<migration_name>/down.sql`.
3. Opens a database transaction.
4. Executes the DDL statements in `down.sql`.
5. Updates `_prisma_migrations` setting `rolled_back_at = NOW()` for audit traceability.
6. Commits the transaction.

---

## 4. Shadow Database & Schema Drift Detection

Prisma Migrate requires a shadow database to detect drift between the schema model and the migrations directory.
- `SHADOW_DATABASE_URL` is configured in `prisma/schema.prisma` and `.env.example`.
- Run drift detection at any time:
  ```bash
  pnpm run prisma:drift:check
  ```
- If drift is detected, the command exits with code 1 and outputs the SQL discrepancy.
- CI automatically enforces this check on pull requests and before staging/production deployments.
