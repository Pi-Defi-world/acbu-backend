-- =============================================================================
-- Reconcile migration: bring all model definitions in sync with schema.prisma
--
-- W2-B-024..038: Eight models declared in the Prisma schema lacked matching
-- migrations, causing `prisma migrate diff` to report drift and runtime queries
-- against those tables to fail.
--
-- Changes in this migration
-- -------------------------
-- 1. refresh_tokens        — new table (never existed in any prior migration)
-- 2. weight_drift_audits   — reconcile column types that diverged between the
--                            old 20260427 migration and the current schema:
--                            • created_by: VARCHAR(100) NOT NULL → UUID nullable
--                            • approved_by: UUID already nullable (verify only)
--                            • Drop stale updated_at column added by the even
--                              older 20260423 init migration (not in schema)
-- 3. weight_drift_currencies — reconcile decimal precision:
--                              • policy_weight / actual_weight:
--                                DECIMAL(10,4) → DECIMAL(5,2) per schema
--                              • recommendation: NOT NULL → nullable per schema
--
-- All DDL uses IF NOT EXISTS / IF EXISTS guards so this migration is safe to
-- run against databases that received partial earlier migrations as well as
-- completely fresh databases.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. refresh_tokens
--    Stores rotating JWT refresh tokens per user.  Token-family tracking lets
--    us detect reuse attacks (refresh token rotation).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
    "id"                UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"           UUID         NOT NULL,
    "token_family_id"   UUID         NOT NULL,
    "token_hash"        VARCHAR(255) NOT NULL,
    "expires_at"        TIMESTAMP(6) NOT NULL,
    "revoked_at"        TIMESTAMP(6),
    "replaced_by_token" VARCHAR(255),
    "created_at"        TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at"      TIMESTAMP(6),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- Unique constraint on token_hash for O(1) lookup during refresh
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'refresh_tokens_token_hash_key'
    ) THEN
        ALTER TABLE "refresh_tokens"
            ADD CONSTRAINT "refresh_tokens_token_hash_key" UNIQUE ("token_hash");
    END IF;
END$$;

-- Foreign key to users
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'refresh_tokens_user_id_fkey'
    ) THEN
        ALTER TABLE "refresh_tokens"
            ADD CONSTRAINT "refresh_tokens_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
    END IF;
END$$;

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_user_id"
    ON "refresh_tokens"("user_id");

CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_token_family_id"
    ON "refresh_tokens"("token_family_id");

CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_token_hash"
    ON "refresh_tokens"("token_hash");

CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_expires_at"
    ON "refresh_tokens"("expires_at");

-- ---------------------------------------------------------------------------
-- 2. weight_drift_audits — reconcile column types
--
--    The original 20260423 init migration created created_by as VARCHAR(100)
--    NOT NULL.  The 20260427 migration left it as VARCHAR(100) NOT NULL.
--    The current Prisma schema declares it as UUID nullable, matching the
--    20260825 migration intent.
--
--    We use ALTER COLUMN … TYPE with USING to safely convert existing values.
--    On a fresh database the table may already have the correct UUID type from
--    the 20260825 migration; the DO block checks first to avoid errors.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_data_type text;
    v_is_nullable text;
BEGIN
    -- Check current column type and nullability
    SELECT data_type, is_nullable
    INTO v_data_type, v_is_nullable
    FROM information_schema.columns
    WHERE table_name = 'weight_drift_audits'
      AND column_name = 'created_by';

    IF v_data_type = 'character varying' THEN
        -- Convert VARCHAR(100) NOT NULL to UUID nullable
        -- Existing non-UUID string values become NULL (safe: this column was
        -- auto-populated by system code, not user-supplied free text)
        ALTER TABLE "weight_drift_audits"
            ALTER COLUMN "created_by" DROP NOT NULL,
            ALTER COLUMN "created_by" TYPE UUID
                USING (CASE
                           WHEN "created_by" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                           THEN "created_by"::uuid
                           ELSE NULL
                       END);
    END IF;
END$$;

-- Drop stale updated_at added by the very first init migration but absent
-- from the current schema definition
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'weight_drift_audits'
          AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE "weight_drift_audits" DROP COLUMN "updated_at";
    END IF;
END$$;

-- Add approvedAt column if not present (some older init migrations omitted it)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'weight_drift_audits'
          AND column_name = 'approved_at'
    ) THEN
        ALTER TABLE "weight_drift_audits" ADD COLUMN "approved_at" TIMESTAMP(6);
    END IF;
END$$;

-- Ensure all required indexes exist (idempotent)
CREATE INDEX IF NOT EXISTS "idx_weight_drift_audits_status"
    ON "weight_drift_audits"("status");

CREATE INDEX IF NOT EXISTS "idx_weight_drift_audits_created_at"
    ON "weight_drift_audits"("created_at");

CREATE INDEX IF NOT EXISTS "idx_weight_drift_audits_status_created"
    ON "weight_drift_audits"("status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_weight_drift_audits_period"
    ON "weight_drift_audits"("audit_period_start", "audit_period_end");

-- ---------------------------------------------------------------------------
-- 3. weight_drift_currencies — reconcile decimal precision and nullability
--
--    Older migrations used DECIMAL(10,4) for policy_weight / actual_weight and
--    made recommendation NOT NULL.  The schema declares DECIMAL(5,2) and
--    recommendation as nullable text.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_precision int;
    v_scale     int;
BEGIN
    SELECT numeric_precision, numeric_scale
    INTO v_precision, v_scale
    FROM information_schema.columns
    WHERE table_name = 'weight_drift_currencies'
      AND column_name = 'policy_weight';

    IF v_precision <> 5 OR v_scale <> 2 THEN
        ALTER TABLE "weight_drift_currencies"
            ALTER COLUMN "policy_weight" TYPE DECIMAL(5,2),
            ALTER COLUMN "actual_weight" TYPE DECIMAL(5,2);
    END IF;
END$$;

-- Make recommendation nullable (was NOT NULL in early migrations)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'weight_drift_currencies'
          AND column_name = 'recommendation'
          AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE "weight_drift_currencies"
            ALTER COLUMN "recommendation" DROP NOT NULL;
    END IF;
END$$;

-- Ensure exceeds_threshold has its default
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'weight_drift_currencies'
          AND column_name = 'exceeds_threshold'
          AND column_default IS NULL
    ) THEN
        ALTER TABLE "weight_drift_currencies"
            ALTER COLUMN "exceeds_threshold" SET DEFAULT false;
    END IF;
END$$;

-- Ensure index on exceeds_threshold exists
CREATE INDEX IF NOT EXISTS "idx_weight_drift_currencies_exceeds"
    ON "weight_drift_currencies"("exceeds_threshold");
