-- CreateTable
CREATE TABLE IF NOT EXISTS "recovery_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "identifier" VARCHAR(255) NOT NULL,
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "success" BOOLEAN NOT NULL DEFAULT false,
    "reason" VARCHAR(255),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_recovery_attempt_user_id" ON "recovery_attempts"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_recovery_attempt_identifier" ON "recovery_attempts"("identifier");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_recovery_attempt_created_at" ON "recovery_attempts"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_recovery_attempt_success" ON "recovery_attempts"("success");
