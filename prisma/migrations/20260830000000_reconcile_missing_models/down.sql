-- Down Migration: revert reconcile_missing_models
DROP TABLE IF EXISTS "refresh_tokens" CASCADE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'weight_drift_audits' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE "weight_drift_audits" ADD COLUMN "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    END IF;
END$$;
