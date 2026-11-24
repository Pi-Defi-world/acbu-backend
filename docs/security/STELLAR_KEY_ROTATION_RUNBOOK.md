# Stellar Key Rotation & HSM/Multi-Sig Transition Runbook (W11-INC-003)

## Context

Developer `.env` configurations and test scripts previously referenced Stellar testnet/mainnet secret keys (`S...`) that may have been exposed to the `folderOpen` malware loader. Any compromised issuer, distribution, or treasury keypair must be rotated, production signing moved to an HSM or multi-sig custodial service, and account balances/signers verified on Horizon.

## 1. Key Regeneration & Signer Replacement

For each affected account (ACBU issuer, distribution, and treasury):

1. Generate replacement keypairs inside the production HSM / KMS or multi-sig custody platform — **never** on developer workstations or in `.env` files.
2. Add the new HSM / custodial signer public key(s) (`G...`) via `setOptions`:
   - Add each new signer with appropriate weight.
   - Set `lowThreshold`, `medThreshold`, and `highThreshold` so critical operations (`setOptions`, `payment`, `manageData`, `accountMerge` — already blocked by `StellarClient`) require quorum.
   - Set `masterWeight: 0` on the compromised master key so the old `S...` seed can no longer authorize any transaction.
3. For testnet environments where funds/issuance are disposable, create fresh testnet accounts and re-seed contracts rather than reusing exposed seeds.

## 2. Backend Signing Configuration

- **Production / Staging:**
  - Leave `STELLAR_SECRET_KEY` unset.
  - Set `STELLAR_TREASURY_ACCOUNT_ID=<G...>` so `StellarClient` enforces `validateOperationsForTreasuryAccount`.
  - Provide an HSM or multi-sig custodial implementation of `StellarTransactionSigner` (`src/services/stellar/client.ts`) to `new StellarClient({ signer, treasuryAccountId })`.
- **Local Development / CI:**
  - Never commit `S...` seeds in source or tests (`src/services/stellar/client.test.ts` uses an injected `TEST_STELLAR_SECRET_KEY` or a non-secret synthetic placeholder).
  - Restrict `STELLAR_SECRET_KEY` in `.env` to disposable local/testnet keys only.

## 3. Verify Account Balances & Signers

Run the read-only Horizon verification script (accepts `G...` public keys only):

```bash
npx ts-node --transpile-only scripts/verify-stellar-accounts.ts <ISSUER_G> <DISTRIBUTION_G> <TREASURY_G>
```

Confirm:
- All expected XLM and ACBU/USDC balances are intact with no unauthorized mints or transfers.
- Compromised master keys have `weight = 0` or are removed from `signers`.
- Multi-sig thresholds match the production custody policy.
