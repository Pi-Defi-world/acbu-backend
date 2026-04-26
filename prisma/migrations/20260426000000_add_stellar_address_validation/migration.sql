-- B-013: Add validation constraint for stellar_address
-- This ensures no invalid or placeholder Stellar addresses can be stored in the database

-- First, validate existing data (this will fail if there are invalid addresses)
-- Valid Stellar addresses:
-- 1. Must be exactly 56 characters
-- 2. Must start with 'G'
-- 3. Must be valid base32 with checksum (we approximate with pattern matching)
-- 4. Must not be a common placeholder pattern

-- Check for any invalid addresses before adding constraint
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM users
  WHERE stellar_address IS NOT NULL
    AND (
      -- Invalid format: wrong length or doesn't start with G
      LENGTH(stellar_address) != 56
      OR stellar_address NOT LIKE 'G%'
      -- Placeholder patterns
      OR stellar_address ~ '^G[A]{55}$'
      OR stellar_address ~ '^G[B]{55}$'
      OR stellar_address ~ '^G[0]{55}$'
      OR stellar_address LIKE 'GTEST%'
      OR stellar_address LIKE 'GDUMMY%'
      OR stellar_address LIKE 'GPLACEHOLDER%'
      OR stellar_address LIKE 'GXXXXXXXX%'
    );

  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Found % users with invalid stellar_address format. Please clean up data before applying constraint.', invalid_count;
  END IF;
END $$;

-- Add CHECK constraint to enforce valid Stellar address format
ALTER TABLE users
ADD CONSTRAINT chk_valid_stellar_address
CHECK (
  stellar_address IS NULL
  OR (
    -- Valid format: 56 characters, starts with G, base32 characters only
    LENGTH(stellar_address) = 56
    AND stellar_address LIKE 'G%'
    AND stellar_address ~ '^[A-Z2-7]{56}$'
    -- Not a placeholder
    AND stellar_address !~ '^G[A]{55}$'
    AND stellar_address !~ '^G[B]{55}$'
    AND stellar_address !~ '^G[0]{55}$'
    AND stellar_address NOT LIKE 'GTEST%'
    AND stellar_address NOT LIKE 'GDUMMY%'
    AND stellar_address NOT LIKE 'GPLACEHOLDER%'
    AND stellar_address NOT LIKE 'GXXXXXXXX%'
  )
);

-- Add index for faster validation queries
CREATE INDEX IF NOT EXISTS idx_users_stellar_address_not_null
ON users (stellar_address)
WHERE stellar_address IS NOT NULL;
