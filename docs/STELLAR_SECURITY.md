# Stellar Security Measures

User wallets are self-custodied: the backend generates no keypair, never receives
a private key, and stores no material it can turn back into one. See
[WALLET_CUSTODY.md](./WALLET_CUSTODY.md) for the full custody model.

## Account Merge Protection

### Vulnerability

If the platform's Stellar account supports the `account_merge` operation without additional safeguards, a compromised backend could perform the following attack:

1. An attacker gains control of the backend system
2. They invoke `account_merge` on the treasury account, specifying their own account as the destination
3. All assets held by the treasury account (the entire ACBU asset pool) are transferred to the attacker's account
4. The treasury account is destroyed

### Mitigation

The `StellarClient` enforces a security policy that prevents dangerous operations on the treasury account:

**Forbidden Operations:**
- `accountMerge` - Prevents merging the treasury into another account

**Implementation:**

```typescript
// Validation occurs automatically when building transactions
const transaction = await stellarClient.buildTransaction(
  treasuryAccountId,
  operations, // accountMerge operation will be rejected here
);
```

**Behavior:**
- If a forbidden operation is detected on the treasury account, the transaction build fails with an error
- Operations are validated for the account's public key (derived from `STELLAR_SECRET_KEY`)
- Non-treasury accounts can perform any operation (backward compatible)

### Defense in Depth

**Recommended additional safeguards:**

1. **Multi-signature Setup** - Configure the Stellar account with multiple signers so no single compromised key can authorize treasury operations
2. **Stellar Signers Threshold** - Set the master weight and threshold such that treasury operations require multiple signatures
3. **Key Rotation** - Regularly rotate the `STELLAR_SECRET_KEY` and implement key management best practices
4. **Monitoring** - Alert on any attempt to use forbidden operations in logs (`Forbidden treasury operation attempted`)
5. **Network-level Controls** - Restrict outbound connections to only approved Stellar Horizon endpoints

### Testing

Security validation is tested in `src/services/stellar/operationSecurity.test.ts`:

```bash
pnpm test -- operationSecurity.test.ts
```

Test coverage includes:
- Safe operations are allowed for treasury accounts
- Forbidden operations are rejected with clear error messages
- All operations are allowed for non-treasury accounts
- Graceful handling when no treasury account is configured

### Future Enhancements

If additional operations need to be restricted for treasury accounts, add them to `FORBIDDEN_TREASURY_OPERATIONS` in `src/services/stellar/operationSecurity.ts`:

```typescript
const FORBIDDEN_TREASURY_OPERATIONS = [
  "accountMerge",
  // Add more as needed
  "allowTrust", // If vault-specific restrictions are needed
];
```

Each added operation will automatically be validated on all treasury account transactions.
