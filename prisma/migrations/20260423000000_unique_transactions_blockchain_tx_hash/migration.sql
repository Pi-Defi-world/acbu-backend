-- B-074: prevent replay submissions with the same blockchain tx hash.
-- Postgres UNIQUE allows multiple NULLs, so this enforces uniqueness only when present.
CREATE UNIQUE INDEX "uq_transactions_blockchain_tx_hash"
ON "transactions" ("blockchain_tx_hash");

