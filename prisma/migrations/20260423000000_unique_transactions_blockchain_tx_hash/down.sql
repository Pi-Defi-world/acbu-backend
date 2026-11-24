-- Down Migration: drop unique transaction blockchain_tx_hash index
DROP INDEX IF EXISTS "uq_transactions_type_blockchain_tx_hash";
