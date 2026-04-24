-- CreateTable
CREATE TABLE "investment_strategies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "policy_limit_usd" DECIMAL(20,2) NOT NULL,
    "deployed_notional_usd" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "target_apy_bps" INTEGER,
    "risk_tier" VARCHAR(20) NOT NULL DEFAULT 'medium',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_investment_strategies_status" ON "investment_strategies"("status");

-- CreateIndex
CREATE INDEX "idx_investment_strategies_risk_tier" ON "investment_strategies"("risk_tier");

-- CreateIndex
CREATE UNIQUE INDEX "investment_strategies_name_key" ON "investment_strategies"("name");
