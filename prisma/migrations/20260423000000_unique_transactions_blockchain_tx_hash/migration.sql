-- B-074: prevent replay submissions with the same blockchain tx hash for burn transactions.
-- Postgres UNIQUE allows multiple NULLs, so this enforces uniqueness only when present.
CREATE UNIQUE INDEX "uq_transactions_type_blockchain_tx_hash"
ON "transactions" ("type", "blockchain_tx_hash");
