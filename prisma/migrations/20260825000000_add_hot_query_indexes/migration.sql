-- #758: Add targeted indexes for hot query fields that were missing beyond primary keys.
--
-- 1. Webhook: composite (event_type, status) — supports filtering the webhook retry queue
--    by event type and delivery state (e.g. find all pending "transaction.completed" hooks).
--
-- 2. Webhook: composite (status, created_at) — supports the retry-queue worker pattern that
--    scans for pending webhooks ordered by creation time for FIFO processing.
--
-- 3. Transaction: composite (organization_id, created_at DESC) — supports organization-level
--    daily aggregate queries such as daily volume reports, dashboards, and reconciliation
--    jobs that filter by org and group/order by date.

-- Migration also syncs the Prisma schema for the WeightDriftAudit and WeightDriftCurrency
-- models (#745). The underlying tables were created in migration
-- 20260427000000_add_weight_drift_audit but the Prisma model definitions were absent,
-- causing TS2339 errors. No DDL is needed here; adding the models to schema.prisma is
-- sufficient to restore the generated client.

-- Webhook: event_type + status composite index
CREATE INDEX IF NOT EXISTS "idx_webhooks_event_type_status"
    ON "webhooks" ("event_type", "status");

-- Webhook: status + created_at composite index for retry queue worker
CREATE INDEX IF NOT EXISTS "idx_webhooks_status_created_at"
    ON "webhooks" ("status", "created_at");

-- Transaction: organization_id + created_at composite index for org daily aggregates
CREATE INDEX IF NOT EXISTS "idx_transactions_org_id_created_at"
    ON "transactions" ("organization_id", "created_at" DESC);

