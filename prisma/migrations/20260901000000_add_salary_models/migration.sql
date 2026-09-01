-- Migration: 20260901000000_add_salary_models
-- Adds salary_batches, salary_items, salary_schedules tables.
--
-- Idempotent: all statements use IF NOT EXISTS so this migration is safe to
-- run on environments that already have these tables (e.g. those that ran
-- 20260423111042_init which bundled the salary tables with other changes).
--
-- References:
--   W2-B-038 — salaryBatch / salaryItem / salarySchedule models missing
--   schema.prisma models: SalaryBatch, SalaryItem, SalarySchedule

-- ── salary_batches ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "salary_batches" (
    "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "user_id"         UUID         NOT NULL,
    "status"          VARCHAR(20)  NOT NULL DEFAULT 'pending',
    "total_amount"    DECIMAL(20,8) NOT NULL,
    "currency"        VARCHAR(10)  NOT NULL DEFAULT 'ACBU',
    "idempotency_key" VARCHAR(100),
    "created_at"      TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at"    TIMESTAMP(6),

    CONSTRAINT "salary_batches_pkey" PRIMARY KEY ("id")
);

-- ── salary_items ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "salary_items" (
    "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
    "batch_id"         UUID         NOT NULL,
    "recipient_id"     UUID,
    "recipient_address" VARCHAR(56) NOT NULL,
    "amount"           DECIMAL(20,8) NOT NULL,
    "status"           VARCHAR(20)  NOT NULL DEFAULT 'pending',
    "transaction_id"   UUID,
    "error_message"    TEXT,
    "created_at"       TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_items_pkey" PRIMARY KEY ("id")
);

-- ── salary_schedules ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "salary_schedules" (
    "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "user_id"         UUID         NOT NULL,
    "name"            VARCHAR(100) NOT NULL,
    "cron"            VARCHAR(100) NOT NULL,
    "amount_config"   JSONB        NOT NULL,
    "currency"        VARCHAR(10)  NOT NULL DEFAULT 'ACBU',
    "status"          VARCHAR(20)  NOT NULL DEFAULT 'active',
    "last_run_at"     TIMESTAMP(6),
    "next_run_at"     TIMESTAMP(6),
    "created_at"      TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_schedules_pkey" PRIMARY KEY ("id")
);

-- ── Unique constraints ────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "salary_batches_idempotency_key_key"
    ON "salary_batches"("idempotency_key");

CREATE UNIQUE INDEX IF NOT EXISTS "salary_items_transaction_id_key"
    ON "salary_items"("transaction_id");

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_salary_batch_org_id"
    ON "salary_batches"("organization_id");

CREATE INDEX IF NOT EXISTS "idx_salary_batch_user_id"
    ON "salary_batches"("user_id");

CREATE INDEX IF NOT EXISTS "idx_salary_batch_status"
    ON "salary_batches"("status");

CREATE INDEX IF NOT EXISTS "idx_salary_item_batch_id"
    ON "salary_items"("batch_id");

CREATE INDEX IF NOT EXISTS "idx_salary_item_status"
    ON "salary_items"("status");

CREATE INDEX IF NOT EXISTS "idx_salary_schedule_org_id"
    ON "salary_schedules"("organization_id");

CREATE INDEX IF NOT EXISTS "idx_salary_schedule_status"
    ON "salary_schedules"("status");

CREATE INDEX IF NOT EXISTS "idx_salary_schedule_next_run"
    ON "salary_schedules"("next_run_at");

-- ── Foreign keys (DO $$ ... to guard idempotency) ────────────────────────────
DO $$
BEGIN
    -- salary_batches → organizations
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'salary_batches_organization_id_fkey'
    ) THEN
        ALTER TABLE "salary_batches"
            ADD CONSTRAINT "salary_batches_organization_id_fkey"
            FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- salary_batches → users
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'salary_batches_user_id_fkey'
    ) THEN
        ALTER TABLE "salary_batches"
            ADD CONSTRAINT "salary_batches_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    -- salary_items → salary_batches
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'salary_items_batch_id_fkey'
    ) THEN
        ALTER TABLE "salary_items"
            ADD CONSTRAINT "salary_items_batch_id_fkey"
            FOREIGN KEY ("batch_id") REFERENCES "salary_batches"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- salary_items → transactions
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'salary_items_transaction_id_fkey'
    ) THEN
        ALTER TABLE "salary_items"
            ADD CONSTRAINT "salary_items_transaction_id_fkey"
            FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- salary_schedules → organizations
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'salary_schedules_organization_id_fkey'
    ) THEN
        ALTER TABLE "salary_schedules"
            ADD CONSTRAINT "salary_schedules_organization_id_fkey"
            FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- salary_schedules → users
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'salary_schedules_user_id_fkey'
    ) THEN
        ALTER TABLE "salary_schedules"
            ADD CONSTRAINT "salary_schedules_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
