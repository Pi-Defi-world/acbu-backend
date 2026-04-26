-- B-013: Validate existing stellar addresses before applying migration
-- Run this SQL directly against your database to check for invalid addresses

-- Check for invalid addresses
SELECT 
  id,
  username,
  stellar_address,
  created_at,
  CASE 
    WHEN LENGTH(stellar_address) != 56 THEN 'Invalid length: ' || LENGTH(stellar_address) || ' (expected 56)'
    WHEN stellar_address NOT LIKE 'G%' THEN 'Does not start with G'
    WHEN stellar_address ~ '^G[A]{55}$' THEN 'Placeholder pattern: All As'
    WHEN stellar_address ~ '^G[B]{55}$' THEN 'Placeholder pattern: All Bs'
    WHEN stellar_address ~ '^G[0]{55}$' THEN 'Placeholder pattern: All zeros'
    WHEN stellar_address LIKE 'GTEST%' THEN 'Placeholder pattern: GTEST...'
    WHEN stellar_address LIKE 'GDUMMY%' THEN 'Placeholder pattern: GDUMMY...'
    WHEN stellar_address LIKE 'GPLACEHOLDER%' THEN 'Placeholder pattern: GPLACEHOLDER...'
    WHEN stellar_address LIKE 'GXXXXXXXX%' THEN 'Placeholder pattern: GXXXXXXXX...'
    ELSE 'Invalid format'
  END as issue
FROM users
WHERE stellar_address IS NOT NULL
  AND (
    LENGTH(stellar_address) != 56
    OR stellar_address NOT LIKE 'G%'
    OR stellar_address ~ '^G[A]{55}$'
    OR stellar_address ~ '^G[B]{55}$'
    OR stellar_address ~ '^G[0]{55}$'
    OR stellar_address LIKE 'GTEST%'
    OR stellar_address LIKE 'GDUMMY%'
    OR stellar_address LIKE 'GPLACEHOLDER%'
    OR stellar_address LIKE 'GXXXXXXXX%'
  );

-- Count of invalid addresses
SELECT COUNT(*) as invalid_address_count
FROM users
WHERE stellar_address IS NOT NULL
  AND (
    LENGTH(stellar_address) != 56
    OR stellar_address NOT LIKE 'G%'
    OR stellar_address ~ '^G[A]{55}$'
    OR stellar_address ~ '^G[B]{55}$'
    OR stellar_address ~ '^G[0]{55}$'
    OR stellar_address LIKE 'GTEST%'
    OR stellar_address LIKE 'GDUMMY%'
    OR stellar_address LIKE 'GPLACEHOLDER%'
    OR stellar_address LIKE 'GXXXXXXXX%'
  );

-- Total users with stellar addresses
SELECT COUNT(*) as total_users_with_addresses
FROM users
WHERE stellar_address IS NOT NULL;
