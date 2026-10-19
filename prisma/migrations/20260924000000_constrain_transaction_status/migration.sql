-- Migration: 20260924000000_constrain_transaction_status
-- AB-023: transactions.status was an unconstrained VARCHAR, so typos or
-- ad-hoc values (e.g. the upper-case "FAILED" written by acbuMinting.service)
-- could be stored and silently dropped out of status-based queries.
--
-- Allowed values mirror TRANSACTION_STATUSES in
-- src/utils/transactionStateMachine.ts — keep both in sync.

-- 1. Normalise existing rows written with the wrong case/whitespace.
UPDATE "transactions"
SET "status" = lower(trim("status"))
WHERE "status" <> lower(trim("status"));

-- 2. Refuse to continue if any other illegal value remains, rather than
--    guessing how to remap it. Fix those rows manually, then re-run.
DO $$
DECLARE
  bad TEXT;
BEGIN
  SELECT string_agg(DISTINCT "status", ', ') INTO bad
  FROM "transactions"
  WHERE "status" NOT IN ('pending', 'processing', 'completed', 'failed', 'refunded');

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'transactions.status contains unsupported values: %', bad;
  END IF;
END $$;

-- 3. Enforce the allowed set at the database level.
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "chk_transactions_status";
ALTER TABLE "transactions"
  ADD CONSTRAINT "chk_transactions_status"
  CHECK ("status" IN ('pending', 'processing', 'completed', 'failed', 'refunded'));
