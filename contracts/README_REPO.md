# ACBU Smart Contracts (Soroban) — Full Repository / Project Guide

> **Scope**: This document explains the repository contents end-to-end: workspace structure, each contract crate, shared types, tests, build & deployment flow, and how the security model ties all components together.
>
> The repository targets **Soroban** (Stellar smart contracts) using **Rust**.

---

## 1. What this repo is

This repository is a Rust workspace containing multiple Soroban smart contracts that implement the core on-chain components of the **ACBU** (African Currency Basket Unit) protocol.

At a high level, the system is a stablecoin-like protocol that supports:

- **Minting** ACBU from different deposit sources (USDC deposits, Afreum-style basket S-token deposits, and fiat flows mediated by a fintech operator).
- **Burning / Redemption** of ACBU back into Afreum S-tokens (single currency or basket redemption).
- **Oracle-based pricing** for exchange rates needed to compute mint/burn amounts.
- **Reserve tracking** to enforce an overcollateralization policy.
- Additional optional protocol components:
  - **Savings vault** (term-based deposits with yield accrual).
  - **Lending pool** (a basic peer-to-peer, uncollateralized ACBU lending protocol).
  - **Escrow** (merchant/e-commerce style payment escrow).
- **Multisig administration** to protect privileged actions (pause, upgrades, parameter changes).

All contracts interact using explicit **cross-contract calls** and rely heavily on Soroban’s authorization model (`require_auth`) and a threat model that documents the authorization invocation trees.

---

## 2. Workspace layout (Cargo workspace)

The root `Cargo.toml` defines a workspace with multiple member crates:

- `acbu_minting`
- `acbu_burning`
- `acbu_oracle`
- `acbu_reserve_tracker`
- `acbu_savings_vault`
- `acbu_lending_pool`
- `acbu_escrow`
- `acbu_multisig`
- `shared`

The repository also contains:

- Deployment and operational markdown docs (deployment guide, integration guide, etc.).
- Scripts under `scripts/` for deployment, verification, and WASM fetching.
- Root-level tests under `tests/` for integration scenarios.

---

## 3. Root-level documentation overview

The root contains several documentation files that form an operational “playbook”:

- **`README.md`**: Intro-level project overview (contracts list, prerequisites, basic build/test/deploy flow).
- **`QUICKSTART.md`**: A step-by-step “getting started” guide for building, deploying, and integrating from a backend perspective.
- **`INTEGRATION.md`**: Backend integration flow and example usage patterns.
- **`DEPLOYMENT.md`**: Deployment prerequisites and initialization procedures.
- **`IMPLEMENTATION_SUMMARY.md` / `SECURITY_FIX_SUMMARY.md`**: Notes about specific implementation/security fixes.
- **`WASM_INTEGRITY.md`**: Explains how the repository verifies that token WASM artifacts are not tampered with.
- **`docs/`**: Additional technical docs:
  - `docs/threat-model.md` (authorization invocation trees and trust assumptions)
  - `docs/upgrade-runbook.md`
  - `docs/ERROR_CODES.md`
  - `docs/reentrancy-audit-c036.md`

---

## 4. Build integrity and supply-chain protection

### 4.1 `build.rs`

The root `build.rs` is a critical security component. It ensures that `soroban_token_contract.wasm` exists and matches an expected SHA-256 hash.

Key behaviors:

1. If `soroban_token_contract.wasm` is missing, the build fails with guidance to fetch it.
2. It computes SHA-256 locally (without external hashing crates) and compares against an expected hash.
3. It also checks that contract sources that import this WASM pin the same hash.

This means:

- The WASM artifact is **not stored in git**.
- You must fetch it via `./scripts/fetch_token_wasm.sh`.
- If a malicious artifact is introduced, the build will fail.

### 4.2 Contract imports

Inside contract code (e.g., minting), each contract uses `soroban_sdk::contractimport!` with `file = "../soroban_token_contract.wasm"` and a pinned `sha256 = "..."`.

So the build-time verification and the code-level pinning are aligned.

---

## 5. Shared crate (`shared/`)

The `shared` crate holds protocol-wide constants, cross-contract data types, and helper functions.

### 5.1 `shared/src/lib.rs`

The file includes:

- **DataKey enum**: currently only includes `Version`.
- **Administration / multisig data types**:
  - `AdminProposal`
  - `MultisigConfig`
  - Event types for proposal creation/approval/execution.
- **Financial types**:
  - `CurrencyCode` (a wrapper around a single Soroban `String`)
  - `RateData`
  - `ReserveData`
  - `AccountDetails` (bank/account details for withdrawals)
- **Event payload structs**:
  - `MintEvent`
  - `BurnEvent`
  - `RateUpdateEvent`
  - `OutlierDetectionEvent`
- **Shared error type**: `ContractError` (used by the burning contract and potentially re-used).
- **Cross-contract method name constants** (string method identifiers to prevent typos):
  - `ORACLE_GET_ACBU_RATE`, `ORACLE_GET_ACBU_RATE_WITH_TS`
  - `ORACLE_GET_RATE`, `ORACLE_GET_RATE_WITH_TS`
  - `ORACLE_GET_CURRENCIES`
  - `ORACLE_GET_BASKET_WEIGHT`
  - `ORACLE_GET_S_TOKEN_ADDR`
  - `RESERVE_IS_SUFFICIENT`
- **Numeric constants**:
  - `BASIS_POINTS = 10_000`
  - `DECIMALS = 10_000_000` (7 decimals fixed-point)
  - `MIN_MINT_AMOUNT`, `MAX_MINT_AMOUNT`, `MIN_BURN_AMOUNT`
  - `UPDATE_INTERVAL_SECONDS = 21_600` (6 hours)
  - `STALE_RATE_MAX_LEDGERS = 4_320`
  - outlier/emergency thresholds

### 5.2 Helper functions

- `calculate_fee(amount, fee_rate_bps)`
- `calculate_amount_after_fee(amount, fee_rate_bps)`
- `median(values)` with an in-place quickselect implementation for gas/compute efficiency.
- `calculate_deviation(value1, value2)` for oracle outlier detection.

---

## 6. Contract: Minting (`acbu_minting/`)

The minting contract is the “front door” for creating ACBU.

### 6.1 Responsibilities

- Accept deposit inputs and mint ACBU to a recipient.
- Compute mint amounts using oracle pricing.
- Enforce reserve sufficiency before minting.
- Collect fees and mint fee ACBU to a treasury.
- Emit `MintEvent` for backend processing.
- Provide admin/operator controls (pause, fee configuration, upgrades).

### 6.2 Entry points (from `acbu_minting/src/lib.rs`)

The contract defines multiple minting flows:

1. **`initialize`**
   - Sets admin, oracle, reserve tracker, token addresses (ACBU, USDC), vault, treasury.
   - Sets fee rates (`fee_rate_bps` and `fee_single_bps`).
   - Initializes supply tracking, paused state, and mint amount bounds.

2. **`mint_from_usdc`**
   - User authorizes (`user.require_auth()`).
   - Validates recipient is an account (intent: avoid minting to contract addresses that cannot receive token transfers).
   - Checks `min_mint_amount` / `max_mint_amount`.
   - Calls oracle for ACBU/USD **with timestamp** and checks freshness.
   - Computes ACBU amount from USDC minus fee.
   - Calls reserve tracker `is_reserve_sufficient(projected_supply)`.
   - Transfers USDC into the contract, then mints ACBU via `StellarAssetClient::mint`.
   - Emits `MintEvent`.

3. **`mint_from_basket`**
   - User auth + proof tracking for basket deposits.
   - Pulls each Afreum S-token leg from the user into the minting contract’s vault according to oracle weights.
   - Uses oracle rates with freshness checks.
   - Reserve check and then mints net ACBU to recipient; fee ACBU to treasury.
   - Emits `MintEvent`.

4. **`mint_from_single`**
   - Single-currency Afreum S-token deposit.
   - Computes USD gross from `(s_token_amount * rate) / DECIMALS`.
   - Applies a higher fee tier `fee_single`.
   - Converts USD to ACBU using ACBU/USD oracle rate.
   - Transfers the S-token into the vault and mints ACBU.
   - Emits `MintEvent`.

5. **`mint_from_demo_fiat`**
   - Operator-only flow using a custodial demo setup.
   - Operator must match stored operator address and provides `require_auth`.
   - Pulls S-tokens from the minting contract custody into the vault.
   - Mints based on oracle rate pricing.
   - Uses proof tracking to prevent replay.

6. **`mint_from_fiat`** (fintech partner fiat mint)
   - Operator-only.
   - Enforces strict validation of `fintech_tx_id` (length and allowed charset).
   - Prevents duplicate processing by storing processed IDs (map of `fintech_tx_id -> bool`).
   - Calls oracle timestamped functions and enforces freshness.
   - Enforces min/max amount.
   - Calls reserve tracker.
   - Mints ACBU to recipient and mints fee ACBU to treasury.
   - Marks `fintech_tx_id` as processed.
   - Emits `MintEvent`.

> Note: The contract file contains some legacy/duplicated sections in the snippet output that look like intermediate refactors. The conceptual behavior of the operator-only / oracle-with-freshness / reserve-check / processed-tx-id prevention is clearly present.

### 6.3 Operator vs admin model

- **Admin**: manages contract configuration, pause/unpause, dependency updates, fee rates, operator address, supply sync, upgrades.
- **Operator**: a dedicated “fintech backend” address allowed to call operator-restricted fiat mint entrypoints.

The contract uses:

- `operator.require_auth()` for cryptographic authorization.
- Additional check `operator == expected_operator` to bind the passed address to the configured one.

### 6.4 Upgrade and timelock model

Minting implements `upgrade(new_wasm_hash, new_version)` gated by admin and gated by paused state.

It updates the contract WASM via `env.deployer().update_current_contract_wasm` and runs migrations for version steps.

In this repo, multiple contracts follow a similar approach.

---

## 7. Contract: Burning (`acbu_burning/`)

The burning contract handles ACBU redemption into Afreum S-tokens (either one currency or the full basket).

### 7.1 Responsibilities

- Burn ACBU from the user.
- Redeem into local currency represented by Afreum S-tokens.
- Validate oracle freshness before calculating redemption outputs.
- Verify protocol health by calling reserve tracker.
- Compute and apply redemption fees.
- Pull S-tokens from a configured vault using `transfer_from`.
- Emit `BurnEvent` for backend processing.

### 7.2 Entry points

1. **`initialize`**
   - Sets admin, oracle, reserve tracker, ACUB token, withdrawal processor, vault.
   - Sets fee rates: `fee_rate_bps` (basket) and `fee_single_redeem_bps` (single).
   - Sets min burn amount, paused state, and version.

2. **`redeem_single`**
   - `user.require_auth()`.
   - Validates `acbu_amount >= min_burn_amount`.
   - Gets oracle rates with freshness checks.
   - Computes stoken output from net acbu and rates.
   - Calls reserve tracker (enforces solvency).
   - Burns ACBU with `acbu_client.burn(&user, &acbu_amount)`.
   - Pulls S-tokens from vault to the user/recipient via `transfer_from`.
   - Emits `BurnEvent` with gross and net ACBU fields.

3. **`redeem_basket`**
   - `user.require_auth()`.
   - Validates non-empty recipients and no duplicate recipient addresses.
   - Validates oracle freshness.
   - Computes fees at basket level and then slices outputs per-currency by weights.
   - Burns ACBU.
   - For each basket currency:
     - Computes currency output and per-leg fee.
     - Uses oracle s-token address and calls `transfer_from` from vault.
     - Emits one `BurnEvent` per leg.

4. **Admin controls**
   - pause/unpause
   - fee rate setters
   - dependency updaters (oracle, reserve tracker, acbu token, vault)
   - `upgrade`

### 7.3 Important token transfer trust assumption (vault approvals)

Burning uses a **pull model** from a vault:

- The vault must have granted this burning contract an allowance via `approve` on each S-token.
- `transfer_from` will revert if approvals are missing.

This trust assumption is documented in `docs/threat-model.md`.

---

## 8. Contract: Oracle (`acbu_oracle/`)

The oracle contract aggregates exchange rates from multiple validators and provides derived basket pricing.

### 8.1 Responsibilities

- Maintain a validator set.
- Enforce that rate updates require validator authorization.
- Compute a robust median from submitted source rates.
- Detect outliers (based on deviation thresholds).
- Enforce rate staleness at read time.
- Provide:
  - currency/USD rates
  - ACBU/USD basket-weighted rate

### 8.2 Entry points and admin controls

1. **`initialize`**
   - Sets admin.
   - Sets validators and `min_signatures`.
   - Sets supported currencies and basket weights.
   - Initializes internal maps for rates and s-token addresses.

2. **`transfer_admin` / `accept_admin` / `cancel_admin_transfer`**
   - Two-step admin rotation with a 24-hour timelock.

3. **`update_rate`**
   - Called by a validator (requires `validator.require_auth()`).
   - Checks validator membership.
   - Enforces update intervals (6 hours semantics) unless emergency deviation criteria are met.
   - Requires sufficient number of sources for the quorum.
   - Computes median from sources.
   - Rejects sources that deviate too much and emits outlier events.
   - Stores the final median rate in `RateData` including:
     - `rate_usd`
     - `timestamp`
     - `sources`
     - `ledger` sequence number
   - Emits `RateUpdateEvent`.

4. **`get_rate` / `get_rate_with_timestamp`**
   - Reads rate from storage.
   - Enforces staleness using ledger age.

5. **`get_acbu_usd_rate_with_timestamp` / `get_acbu_usd_rate`**
   - Computes a basket-weighted ACBU/USD rate.
   - Each basket component must itself be fresh.

6. **Validator management**
   - Schedule and execute validator set changes, also timelocked.

7. **Upgrade / migration**
   - Supports proposing, executing, cancelling upgrades with timelock.
   - Includes a `migrate` method to backfill older storage schema differences.

---

## 9. Contract: Reserve Tracker (`acbu_reserve_tracker/`)

The reserve tracker maintains reserve balances for each supported currency and verifies if reserves meet the protocol’s required overcollateralization ratio.

### 9.1 Responsibilities

- Store reserve data per currency:
  - reserve amount
  - USD value
  - timestamp
- Provide total reserve USD value.
- Verify reserves against ACBU total supply.
- Enforce a minimum reserve ratio.

### 9.2 Key entry points

- `initialize(admin, oracle, acbu_token, min_reserve_ratio_bps)`
  - Stores admin, oracle, acbu token.
  - Sets reserve map.

- `update_reserve(env, _updater, currency, amount, value_usd)`
  - Admin-only.
  - Updates reserve record and emits a `reserve` event.

- `verify_reserves(env)`
  - Reads ACBU total supply from the ACBU token contract.
  - If supply is zero, it panics with `ZeroSupply`.
  - Calls `is_reserve_sufficient`.

- `is_reserve_sufficient(env, total_acbu_supply)`
  - Aggregates total reserve USD value.
  - Fetches ACBU/USD oracle rate via oracle contract.
  - Computes `total_acbu_usd` and checks `current_ratio >= min_reserve_ratio`.

> The minting contract uses `RESERVE_IS_SUFFICIENT` cross-contract call to validate projected supply before minting.

---

## 10. Optional protocol contracts

### 10.1 Savings vault (`acbu_savings_vault/`)

This contract locks ACBU for term-based deposits and accrues yield.

Main entry points:

- `initialize(admin, acbu_token, fee_rate_bps, yield_rate_bps)`
- `deposit(user, amount, term_seconds)`
- `withdraw(user, term_seconds, amount)`
- `get_balance(user, term_seconds)`
- `get_pending_yield(user, term_seconds)`
- `pause` / `unpause`

Yield model:

- Uses a prorated APR-like computation with seconds elapsed.
- Tracks deposits as temporary “deposit lots” keyed by `(DEPOSIT_KEY, user, term_seconds)`.

> The contract file shows some inconsistencies/duplicate signatures in the snippet output, but the overall contract intent is clear: time-locked deposits with yield computed on unlock.

### 10.2 Lending pool (`acbu_lending_pool/`)

This contract provides simplified lending features:

- `initialize(admin, acbu_token, fee_rate_bps)`
- `deposit(lender, amount)`
- `withdraw(lender, amount)`
- `borrow(borrower, lender, amount, loan_id)`
- `repay(borrower, amount, loan_id)`
- pause/unpause and upgrades.

The contract stores:

- per-lender balances
- active loans (as `LoanData` keyed by `(borrower, loan_id)`)
- accrued interest and repayment due

Collateral policy (in the borrow entrypoint):

- The pool is **single-asset and uncollateralized**. Both the liquidity and the
  loan principal are ACBU, and no collateral is taken.
- An earlier iteration pulled a `collateral_amount` of ACBU and required
  `collateral_amount >= amount` before paying out the same ACBU token. That is a
  degenerate arrangement — it locks at least as much of the borrowed asset as it
  releases, so it extends no purchasing power and offers the lender no protection
  — and there was no liquidation path able to seize it. It has been removed.
- Because the loan is unsecured, `borrow` requires authorization from **both**
  the borrower and the lender: depositing liquidity is not an open offer to lend
  it to anyone, so each loan is an explicit peer-to-peer agreement signed by both
  parties.
- `LoanData.collateral_amount` is retained (always `0`) and error code `2014`
  (`InsufficientCollateral`) is reserved for a future *distinct-asset* collateral
  extension, which additionally needs oracle pricing and a liquidation path.
- There is no `liquidate()` entrypoint yet; an unrepaid loan simply stays open.

### 10.3 Escrow (`acbu_escrow/`)

This is an escrow contract for merchants:

- `initialize(admin, acbu_token)`
- `create(payer, payee, amount, escrow_id)`
- `release(escrow_id, payer)`
- `refund(escrow_id, payer)` (admin only)

Important design point:

- Uses temporary storage keyed by `EscrowId(payer, escrow_id)`.
- Implements CEI ordering (commit escrow state before external transfer; remove record before releasing/refunding) to prevent re-entrancy/replay within contract logic.

### 10.4 Emergency multisig (`acbu_multisig/`)

Admin protection is critical.

`acbu_multisig` implements a standalone M-of-N multisig guard.

Other contracts:

- store the multisig contract address in their admin slot.
- their admin-only functions call `admin.require_auth()`.
- Soroban auth tree then propagates the multisig approval.

The multisig contract manages proposals with:

- `propose`
- `approve`
- `execute`

It includes TTL/expiration enforcement.

---

## 11. Tests

The repository has:

- Root tests in `tests/`:
  - `integration_mint_burn_flow.rs`
  - `integration_rounding.rs`

- Per-contract test directories:
  - `acbu_minting/tests/`
  - `acbu_burning/tests/`
  - etc.

These tests validate:

- correctness of pricing and rounding behavior
- authorization enforcement
- edge cases such as replay prevention (`fintech_tx_id` duplicates)
- full lifecycle flows (mint → burn)

---

## 12. Scripts (`scripts/`)

The repo includes operational scripts used for:

- deploying to testnet and mainnet (`deploy_testnet.sh`, `deploy_mainnet.sh`)
- deploying contracts as a set (`deploy.sh`)
- fetching the pinned token WASM (`fetch_token_wasm.sh`)
- verifying deployments (`verify_deployment.sh`, `verify_wasm_hash.sh`)
- initializing oracle and other dependencies

Scripts may depend on environment variables and the presence of WASM artifacts.

---

## 13. Backend integration (TypeScript) note

This repository primarily contains on-chain contracts.

However, documentation such as `INTEGRATION.md` describes a backend that:

- Calls contract entrypoints using Stellar/Soroban clients
- Listens for emitted events (MintEvent, BurnEvent, RateUpdateEvent, etc.)
- Performs off-chain actions (e.g., USDC conversion, fiat withdrawal processing)

The backend uses event topics to map contract actions to off-chain queues.

---

## 14. Security model: authorization invocation trees

The contract security model is not just “check auth”; it is a documented chain of trust.

See `docs/threat-model.md`.

It explains:

- Contract topology
- Cross-contract call inventory (which methods are called by whom)
- Auth requirements and staleness guards
- Wrong-invoker scenarios and mitigations
- Deployment checklist for admin and vault approvals

---

## 15. Operational checklist

The repo’s docs emphasize an operational deployment and verification workflow:

1. Fetch and verify WASM artifacts.
2. Compile contracts.
3. Deploy the oracle first.
4. Deploy reserve tracker.
5. Deploy minting and burning.
6. Initialize each contract with the correct dependency addresses.
7. Configure vault approvals for S-token redemption.
8. Set up operator keys and multisig admin.
9. Run tests on testnet.
10. Verify via scripts and explorer.

---

## 16. How to navigate the code quickly

When reading the code, the fastest path is:

- `shared/src/lib.rs`:
  - constants, event payloads, helper math
- `acbu_oracle/src/lib.rs`:
  - rate storage + freshness rules
- `acbu_reserve_tracker/src/lib.rs`:
  - reserve ratio check + total supply read
- `acbu_minting/src/lib.rs`:
  - mint entrypoints and fiat replay/validation rules
- `acbu_burning/src/lib.rs`:
  - burn entrypoints and vault transfer mechanics
- Optional contracts:
  - `acbu_savings_vault/`, `acbu_lending_pool/`, `acbu_escrow/`
- `docs/threat-model.md`:
  - read this after skimming contract code to understand why each auth call exists.

---

## 17. Summary

This repository is a multi-contract Soroban implementation of the ACBU protocol.

Its design hinges on:

- **Oracle correctness and freshness enforcement** (median aggregation + ledger/time staleness checks).
- **Reserve sufficiency checks** before minting/burning.
- **Token transfer safety** through documented vault approval assumptions.
- **Strict authorization** using Soroban auth propagation.
- **Replay prevention** for fiat mint flows (fintech transaction IDs).
- **Defense-in-depth administration** using an emergency multisig guard.
- **Supply chain integrity** via pinned WASM hash verification.

The output of contracts (events) is intended to drive backend and off-chain processing.

---

## Appendix A: Repo files that are important for operations

- `build.rs` — verifies `soroban_token_contract.wasm` integrity.
- `scripts/fetch_token_wasm.sh` — downloads pinned token WASM.
- `scripts/deploy_*.sh` — deploy contracts.
- `scripts/verify_*.sh` — verify deployed WASM hashes.
- `docs/threat-model.md` — cross-contract authorization and trust model.
- `docs/upgrade-runbook.md` — upgrade procedures and safety gates.
- `docs/ERROR_CODES.md` — user-friendly explanation of error codes.

---

## Appendix B: Contract list (quick reference)

- `acbu_minting`: mints ACBU from USDC / basket S-tokens / single S-token / fiat via operator.
- `acbu_burning`: redeems ACBU back into S-tokens (single or basket).
- `acbu_oracle`: stores and publishes currency rates and basket ACBU/USD.
- `acbu_reserve_tracker`: stores reserves and enforces minimum reserve ratio.
- `acbu_savings_vault`: term deposits with yield.
- `acbu_lending_pool`: peer-to-peer, uncollateralized ACBU lending.
- `acbu_escrow`: escrow create/release/refund.
- `acbu_multisig`: emergency M-of-N admin guard.
- `shared`: shared event payloads, constants, and math.

