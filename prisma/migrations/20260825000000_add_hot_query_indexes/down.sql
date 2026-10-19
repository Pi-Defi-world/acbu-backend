-- Down Migration: drop hot query indexes
DROP INDEX IF EXISTS "idx_transactions_org_id_created_at";
DROP INDEX IF EXISTS "idx_webhooks_status_created_at";
DROP INDEX IF EXISTS "idx_webhooks_event_type_status";
