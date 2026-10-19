-- Down Migration: revert webhook event_id
DROP INDEX IF EXISTS "idx_webhooks_event_id_unique";
ALTER TABLE "webhooks" DROP COLUMN IF EXISTS "event_id";
