-- Down Migration: revert raw_values from oracle_rates
ALTER TABLE "oracle_rates" DROP COLUMN IF EXISTS "raw_values";
