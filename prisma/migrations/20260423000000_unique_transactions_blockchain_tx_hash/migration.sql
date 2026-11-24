-- B-074: prevent replay submissions with the same blockchain tx hash for burn transactions.
-- Deduplicate pre-existing rows before enforcing the constraint.
-- For each (type, blockchain_tx_hash) pair with duplicates, keep the oldest
-- (by created_at) and delete newer rows. Rows with NULL type or hash are never
-- duplicates and are preserved.
-- NOTE: transactions.id is a UUID, so MIN(id)/MAX(id) do not exist in Postgres;
-- ordering by created_at (then id as tiebreaker) instead.
DELETE FROM "transactions" t
WHERE t.id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY "type", "blockchain_tx_hash"
        ORDER BY "created_at" ASC, "id" ASC
      ) AS rn
    FROM "transactions"
    WHERE "type" IS NOT NULL AND "blockchain_tx_hash" IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- Postgres UNIQUE allows multiple NULLs, so this enforces uniqueness only when present.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_transactions_type_blockchain_tx_hash"
ON "transactions" ("type", "blockchain_tx_hash");
