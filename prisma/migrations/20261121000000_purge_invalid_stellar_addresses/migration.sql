-- #1313: remove legacy placeholder/invalid Stellar addresses from users and
-- enforce the G-address format at the database layer so no bad row can ship to
-- production. Historical migrations used a snake_case column while the Prisma
-- model uses camelCase, so resolve the real column name at runtime.

DO $stellar_address_policy$
DECLARE
  address_column text;
BEGIN
  SELECT column_name INTO address_column
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'users'
    AND column_name IN ('stellarAddress', 'stellar_address')
  ORDER BY CASE WHEN column_name = 'stellarAddress' THEN 0 ELSE 1 END
  LIMIT 1;

  IF address_column IS NULL THEN
    RAISE NOTICE 'No Stellar address column on users; skipping cleanup';
    RETURN;
  END IF;

  -- Clear every value that is not a well-formed G-address or that matches a
  -- known dummy pattern (including the old P-prefixed signup placeholder).
  EXECUTE format(
    'UPDATE users SET %1$I = NULL WHERE %1$I IS NOT NULL AND ('
      'length(%1$I) <> 56'
      ' OR %1$I !~ ''^G[A-Z2-7]{55}$'''
      ' OR %1$I ~ ''^G[A]{55}$'''
      ' OR %1$I ~ ''^G[B]{55}$'''
      ' OR %1$I ~ ''^G[0]{55}$'''
      ' OR %1$I LIKE ''GTEST%%'''
      ' OR %1$I LIKE ''GDUMMY%%'''
      ' OR %1$I LIKE ''GPLACEHOLDER%%'''
      ' OR %1$I LIKE ''GXXXXXXXX%%'''
      ')', address_column
  );

  EXECUTE format('ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_valid_stellar_address');

  EXECUTE format(
    'ALTER TABLE users ADD CONSTRAINT chk_valid_stellar_address CHECK ('
      '%1$I IS NULL OR ('
        '%1$I ~ ''^G[A-Z2-7]{55}$'''
        ' AND %1$I !~ ''^G[A]{55}$'''
        ' AND %1$I !~ ''^G[B]{55}$'''
        ' AND %1$I !~ ''^G[0]{55}$'''
        ' AND %1$I NOT LIKE ''GTEST%%'''
        ' AND %1$I NOT LIKE ''GDUMMY%%'''
        ' AND %1$I NOT LIKE ''GPLACEHOLDER%%'''
        ' AND %1$I NOT LIKE ''GXXXXXXXX%%'''
      '))', address_column
  );
END
$stellar_address_policy$;
