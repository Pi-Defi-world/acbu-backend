ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "organization_id" UUID;

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "idx_transactions_organization_id"
  ON "transactions"("organization_id");
