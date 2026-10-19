-- CreateTable
CREATE TABLE IF NOT EXISTS "weight_drift_audits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "audit_period_start" TIMESTAMP(6) NOT NULL,
    "audit_period_end" TIMESTAMP(6) NOT NULL,
    "total_currencies" INTEGER NOT NULL,
    "currencies_exceeding_threshold" INTEGER NOT NULL,
    "max_drift_percent" DECIMAL(10,4) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "diff_report" JSONB NOT NULL,
    "created_by" VARCHAR(100) NOT NULL,
    "approved_by" VARCHAR(100),
    "approval_notes" TEXT,
    "approved_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weight_drift_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "weight_drift_currencies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "audit_id" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "policy_weight" DECIMAL(10,4) NOT NULL,
    "actual_weight" DECIMAL(10,4) NOT NULL,
    "drift_percent" DECIMAL(10,4) NOT NULL,
    "exceeds_threshold" BOOLEAN NOT NULL,
    "recommendation" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weight_drift_currencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_weight_drift_audit_status" ON "weight_drift_audits"("status");

-- CreateIndex
CREATE INDEX "idx_weight_drift_audit_created_at" ON "weight_drift_audits"("created_at");

-- CreateIndex
CREATE INDEX "idx_weight_drift_currency_audit_id" ON "weight_drift_currencies"("audit_id");

-- CreateIndex
CREATE INDEX "idx_weight_drift_currency_currency" ON "weight_drift_currencies"("currency");

-- AddForeignKey
ALTER TABLE "weight_drift_currencies" ADD CONSTRAINT "weight_drift_currencies_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "weight_drift_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
