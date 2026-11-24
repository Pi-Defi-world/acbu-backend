-- Down Migration: no-op.
-- The wiped blobs cannot be reconstructed without each user's own key, and
-- putting backend-decryptable wallet secrets back is exactly the weakness
-- W10-SEC-006 removes. The table shape is unchanged, so this only has to
-- satisfy the migration history.
SELECT 1;
