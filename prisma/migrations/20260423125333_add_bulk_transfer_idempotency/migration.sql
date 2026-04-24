-- Add idempotency_key column to transactions table for deduplication
ALTER TABLE "transactions" ADD COLUMN "idempotency_key" VARCHAR(255);
CREATE UNIQUE INDEX "idx_transactions_idempotency_key" ON "transactions"("idempotency_key") WHERE "idempotency_key" IS NOT NULL;

-- Create bulk_transfer_jobs table for tracking batch transfer operations
CREATE TABLE "bulk_transfer_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "total_rows" INTEGER NOT NULL,
  "processed_rows" INTEGER NOT NULL DEFAULT 0,
  "success_count" INTEGER NOT NULL DEFAULT 0,
  "failure_count" INTEGER NOT NULL DEFAULT 0,
  "failure_report" JSON,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(6),
  "error_message" TEXT,

  CONSTRAINT "pk_bulk_transfer_jobs" PRIMARY KEY ("id"),
  CONSTRAINT "fk_bulk_transfer_jobs_organization_id" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_bulk_transfer_jobs_organization_id" ON "bulk_transfer_jobs"("organization_id");
CREATE INDEX "idx_bulk_transfer_jobs_status" ON "bulk_transfer_jobs"("status");
CREATE INDEX "idx_bulk_transfer_jobs_created_at" ON "bulk_transfer_jobs"("created_at");
