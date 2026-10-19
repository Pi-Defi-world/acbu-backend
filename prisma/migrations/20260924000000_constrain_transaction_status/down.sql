-- Down Migration: remove transaction status check constraint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "chk_transactions_status";
