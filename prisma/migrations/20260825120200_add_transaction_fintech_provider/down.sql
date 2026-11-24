-- Down Migration: revert fintech_provider from transactions
ALTER TABLE "transactions" DROP COLUMN IF EXISTS "fintech_provider";
