-- Down Migration: revert local_amount precision
ALTER TABLE "transactions"
ALTER COLUMN "local_amount" TYPE DECIMAL(18, 4);
