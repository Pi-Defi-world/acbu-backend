-- Add API key type enum and columns for admin/break-glass separation.
CREATE TYPE "ApiKeyType" AS ENUM ('USER_KEY', 'ADMIN_KEY', 'BREAK_GLASS_KEY');

ALTER TABLE "api_keys"
  ADD COLUMN "key_type" "ApiKeyType" NOT NULL DEFAULT 'USER_KEY',
  ADD COLUMN "created_by_user_id" UUID,
  ADD COLUMN "emergency_reason" VARCHAR(255),
  ADD COLUMN "emergency_expires_at" TIMESTAMP;

CREATE INDEX "idx_api_keys_key_type" ON "api_keys"("key_type");

-- Extend audit trail attribution for privileged/admin actions.
ALTER TABLE "audit_trail"
  ADD COLUMN "actor_type" VARCHAR(20),
  ADD COLUMN "key_type" VARCHAR(32),
  ADD COLUMN "organization_id" UUID,
  ADD COLUMN "reason" VARCHAR(255);

CREATE INDEX "idx_audit_trail_actor_type_timestamp" ON "audit_trail"("actor_type", "timestamp");
CREATE INDEX "idx_audit_trail_org_timestamp" ON "audit_trail"("organization_id", "timestamp");
