/*
  Warnings:

  - A unique constraint covering the columns `[lookup_key]` on the table `api_keys` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[currency,segment,timestamp]` on the table `reserves` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_user_id_fkey";

-- DropIndex
DROP INDEX "idx_reserves_currency_timestamp";

-- DropIndex
DROP INDEX "reserves_currency_timestamp_key";

-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN     "lookup_key" VARCHAR(24);

-- AlterTable
ALTER TABLE "basket_config" ALTER COLUMN "effective_from" SET DATA TYPE TIMESTAMP(6);

-- AlterTable
ALTER TABLE "basket_metrics" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(6);

-- AlterTable
ALTER TABLE "oracle_rates" ADD COLUMN     "raw_values" JSONB;

-- AlterTable
ALTER TABLE "reserves" ADD COLUMN     "segment" VARCHAR(20) NOT NULL DEFAULT 'transactions';

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "stellarAddress" DROP NOT NULL;

-- CreateTable
CREATE TABLE "on_ramp_swaps" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "stellar_address" VARCHAR(56) NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'xlm_deposit',
    "xlm_amount" DECIMAL(20,7),
    "usdc_amount" DECIMAL(20,8),
    "status" VARCHAR(20) NOT NULL,
    "transaction_id" UUID,
    "completed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "on_ramp_swaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_withdrawal_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "organization_id" UUID,
    "audience" VARCHAR(20) NOT NULL,
    "amount_acbu" DECIMAL(20,8) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "forced_removal" BOOLEAN NOT NULL DEFAULT false,
    "fee_percent" DECIMAL(5,2),
    "available_at" TIMESTAMP(6) NOT NULL,
    "notified_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_withdrawal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_batches" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "user_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "total_amount" DECIMAL(20,8) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'ACBU',
    "idempotency_key" VARCHAR(100),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,
    "completed_at" TIMESTAMP(6),

    CONSTRAINT "salary_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_items" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "recipient_id" UUID,
    "recipient_address" VARCHAR(56) NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "transaction_id" UUID,
    "error_message" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "salary_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_schedules" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "cron" VARCHAR(100) NOT NULL,
    "amount_config" JSONB NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'ACBU',
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "last_run_at" TIMESTAMP(6),
    "next_run_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "salary_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_on_ramp_swap_status" ON "on_ramp_swaps"("status");

-- CreateIndex
CREATE INDEX "idx_on_ramp_swap_status_created_at" ON "on_ramp_swaps"("status", "created_at");

-- CreateIndex
CREATE INDEX "idx_on_ramp_swap_source" ON "on_ramp_swaps"("source");

-- CreateIndex
CREATE INDEX "idx_on_ramp_swap_user_id" ON "on_ramp_swaps"("user_id");

-- CreateIndex
CREATE INDEX "idx_on_ramp_swap_created_at" ON "on_ramp_swaps"("created_at");

-- CreateIndex
CREATE INDEX "idx_inv_withdrawal_status" ON "investment_withdrawal_requests"("status");

-- CreateIndex
CREATE INDEX "idx_inv_withdrawal_available_at" ON "investment_withdrawal_requests"("available_at");

-- CreateIndex
CREATE INDEX "idx_inv_withdrawal_user_id" ON "investment_withdrawal_requests"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "salary_batches_idempotency_key_key" ON "salary_batches"("idempotency_key");

-- CreateIndex
CREATE INDEX "idx_salary_batch_org_id" ON "salary_batches"("organization_id");

-- CreateIndex
CREATE INDEX "idx_salary_batch_user_id" ON "salary_batches"("user_id");

-- CreateIndex
CREATE INDEX "idx_salary_batch_status" ON "salary_batches"("status");

-- CreateIndex
CREATE UNIQUE INDEX "salary_items_transaction_id_key" ON "salary_items"("transaction_id");

-- CreateIndex
CREATE INDEX "idx_salary_item_batch_id" ON "salary_items"("batch_id");

-- CreateIndex
CREATE INDEX "idx_salary_item_status" ON "salary_items"("status");

-- CreateIndex
CREATE INDEX "idx_salary_schedule_org_id" ON "salary_schedules"("organization_id");

-- CreateIndex
CREATE INDEX "idx_salary_schedule_status" ON "salary_schedules"("status");

-- CreateIndex
CREATE INDEX "idx_salary_schedule_next_run" ON "salary_schedules"("next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_lookup_key_key" ON "api_keys"("lookup_key");

-- CreateIndex
CREATE INDEX "idx_reserves_segment" ON "reserves"("segment");

-- CreateIndex
CREATE INDEX "idx_reserves_currency_segment_timestamp" ON "reserves"("currency", "segment", "timestamp" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "reserves_currency_segment_timestamp_key" ON "reserves"("currency", "segment", "timestamp");

-- AddForeignKey
ALTER TABLE "on_ramp_swaps" ADD CONSTRAINT "on_ramp_swaps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_batches" ADD CONSTRAINT "salary_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_batches" ADD CONSTRAINT "salary_batches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_items" ADD CONSTRAINT "salary_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "salary_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_items" ADD CONSTRAINT "salary_items_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_schedules" ADD CONSTRAINT "salary_schedules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_schedules" ADD CONSTRAINT "salary_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
