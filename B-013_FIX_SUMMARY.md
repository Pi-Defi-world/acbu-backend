# B-013 Fix: Placeholder/Invalid Stellar Address Prevention

## Issue Summary
**Severity:** High  
**Area:** backend/auth  
**File:** `acbu-backend/src/services/auth/authService.ts` (getPlaceholderStellarAddress)

**Impact:** Non-G placeholders can break downstream Stellar validation and UX.

**Acceptance Criteria:** No user row ships with invalid stellarAddress format in prod.

---

## Root Cause Analysis

The original implementation had several gaps:

1. **No Database Constraint**: The `users.stellar_address` column had no CHECK constraint to prevent invalid addresses from being inserted
2. **No Placeholder Detection**: While wallet creation used `assertValidStellarAddress()`, there was no protection against placeholder/test addresses like "GTEST...", "GDUMMY...", etc.
3. **No Validation on Read**: When reading stellar addresses, there was no validation to catch corrupted/invalid data
4. **Test Pollution**: Test files used invalid placeholder addresses that could accidentally leak into production

---

## Solution Implemented

### 1. Enhanced Wallet Service (`src/services/wallet/walletService.ts`)

#### Added Placeholder Detection
```typescript
function isPlaceholderAddress(address: string): boolean {
  if (!address || address.length !== 56) return true;
  
  const placeholderPatterns = [
    /^G[A]{55}$/,           // All A's (GAAAA...)
    /^G[B]{55}$/,           // All B's (GBBBB...)
    /^G[0]{55}$/,           // All zeros
    /^GTEST/,               // Starts with GTEST
    /^GDUMMY/,              // Starts with GDUMMY
    /^GPLACEHOLDER/,        // Starts with GPLACEHOLDER
    /^GXXXXXXXX/,           // Starts with GXXXXXXXX
  ];

  return placeholderPatterns.some(pattern => pattern.test(address));
}
```

#### Enhanced `ensureWalletForUser()`
- Added validation before persisting generated addresses
- Rejects addresses that match placeholder patterns
- Logs errors for debugging

#### Enhanced `assertUserWalletAddress()`
- Added validation of stored address format (defense in depth)
- Throws 500 error if database contains invalid address
- Logs critical errors for investigation

#### New `setStellarAddressForUser()` Function
- Single entry point for externally setting stellar addresses
- Strict validation with both format and placeholder checks
- Proper error handling and logging

### 2. Database Migration (`prisma/migrations/20260426000000_add_stellar_address_validation/migration.sql`)

#### Pre-flight Validation
```sql
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM users
  WHERE stellar_address IS NOT NULL
    AND (invalid format conditions...);

  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Found % users with invalid stellar_address format...', invalid_count;
  END IF;
END $$;
```

#### CHECK Constraint Added
```sql
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
```

#### Index for Performance
```sql
CREATE INDEX IF NOT EXISTS idx_users_stellar_address_not_null
ON users (stellar_address)
WHERE stellar_address IS NOT NULL;
```

### 3. Validation Script (`prisma/validateStellarAddresses.ts`)

A standalone script to validate existing data before applying migration:

```bash
npx ts-node prisma/validateStellarAddresses.ts
```

**Features:**
- Scans all users with stellar addresses
- Validates format, length, and checksum
- Detects placeholder patterns
- Provides detailed report of invalid addresses
- Suggests remediation options

### 4. Schema Documentation (`prisma/schema.prisma`)

Added comments to document the constraint:
```prisma
model User {
  stellarAddress  String?  @unique @db.VarChar(56)
  // B-013: stellarAddress is validated at application level and database constraint
  // Valid addresses: 56 chars, starts with 'G', base32 encoded, not a placeholder
  ...
}
```

---

## Defense in Depth Strategy

| Layer | Protection | Location |
|-------|-----------|----------|
| **Application** | `assertValidStellarAddress()` | `src/utils/stellar.ts` |
| **Application** | `isPlaceholderAddress()` | `src/services/wallet/walletService.ts` |
| **Application** | Validation on read | `assertUserWalletAddress()` |
| **Database** | CHECK constraint | Migration SQL |
| **Database** | Length constraint | `@db.VarChar(56)` |
| **Database** | Uniqueness constraint | `@unique` |

---

## Migration Steps

### Before Deployment
1. **Run validation script**:
   ```bash
   npx ts-node prisma/validateStellarAddresses.ts
   ```

2. **Fix any invalid addresses** (if found):
   ```sql
   -- Option 1: Clear invalid addresses
   UPDATE users SET stellar_address = NULL WHERE id = 'user-id';
   
   -- Option 2: Replace with valid address (if user has real wallet)
   UPDATE users SET stellar_address = 'GVALID...' WHERE id = 'user-id';
   ```

3. **Apply migration**:
   ```bash
   npx prisma migrate deploy
   ```

### After Deployment
1. Monitor logs for any "Invalid stellar address format in database" errors
2. Verify new user wallets are created successfully
3. Test signin flow to ensure wallet creation works

---

## Testing

### Unit Tests
The wallet service tests use valid Stellar addresses:
- `GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF` (valid test address)
- Avoid using invalid placeholders like `GSTELLAR` or `GSTELLAR2`

### Integration Tests
- Test user signup → signin → wallet creation flow
- Verify stellar address is valid after wallet creation
- Test address validation on transfer operations

### Manual Testing
```typescript
// Should succeed
const validAddress = "G" + randomValidStellarAddress();
await setStellarAddressForUser(userId, validAddress);

// Should fail - placeholder
await setStellarAddressForUser(userId, "GTEST123...");

// Should fail - invalid format
await setStellarAddressForUser(userId, "INVALID");
```

---

## Rollback Plan

If issues arise after deployment:

1. **Remove CHECK constraint**:
   ```sql
   ALTER TABLE users DROP CONSTRAINT chk_valid_stellar_address;
   ```

2. **Revert application code**:
   ```bash
   git revert <commit-hash>
   ```

3. **Monitor**: Watch for any data integrity issues

---

## Files Modified

1. ✅ `src/services/wallet/walletService.ts` - Enhanced validation
2. ✅ `prisma/schema.prisma` - Added documentation
3. ✅ `prisma/migrations/20260426000000_add_stellar_address_validation/migration.sql` - New migration
4. ✅ `prisma/validateStellarAddresses.ts` - Validation script (new)

---

## Acceptance Checklist

- [x] No user can be created with invalid stellarAddress format
- [x] Placeholder addresses are rejected at application layer
- [x] Database CHECK constraint prevents invalid addresses
- [x] Existing data validated before migration
- [x] Validation on read catches any corrupted data
- [x] Proper error logging for debugging
- [x] Documentation added to schema

---

## Additional Notes

### Why Not Use StrKey Validation in Database?
PostgreSQL doesn't have native access to Stellar SDK's `StrKey.isValidEd25519PublicKey()`. The CHECK constraint approximates this with:
- Length check (56 chars)
- Prefix check (starts with 'G')
- Character set check (base32: A-Z, 2-7)
- Placeholder pattern exclusion

Application-level validation provides the full StrKey checksum validation.

### Performance Impact
- Minimal: CHECK constraint is evaluated on INSERT/UPDATE only
- Index added for faster queries on non-null stellar addresses
- Validation on read only happens when asserting wallet address

### Future Improvements
- Consider adding a database trigger to log any validation failures
- Add monitoring alerts for invalid address attempts
- Create admin tool to audit stellar addresses periodically
