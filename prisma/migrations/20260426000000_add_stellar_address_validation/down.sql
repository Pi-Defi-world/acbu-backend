-- Down Migration: drop stellar address validation check constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_valid_stellar_address;
