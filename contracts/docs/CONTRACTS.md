# ACBU Smart Contracts

This document provides an overview of all smart contracts in the ACBU ecosystem.

## Building and Testing

### Build all contracts

```bash
make build
```

### Test all contracts

```bash
cargo test --workspace
```

### Test specific contract

```bash
cargo test -p <contract_name>
```

### Deploy

See [DEPLOYMENT.md](../DEPLOYMENT.md) for deployment instructions.

---

## Minting Contract (`acbu_minting`)

Handles conversion of USDC and fiat deposits into ACBU tokens.

### Key Functions

- `initialize`: Configure admin, oracle, reserve tracker, tokens, and fees
- `mint_from_usdc`: Mint ACBU from USDC deposit
- `mint_from_fiat`: Mint ACBU from fiat deposit via fintech partner
- `mint_from_basket`: Mint ACBU by depositing S-tokens in basket proportions
- `mint_from_single`: Mint ACBU by depositing single S-token
- `pause/unpause`: Emergency pause mechanism
- `set_fee_rate`: Update fee rates

### Token Transfer Model

- Uses push model: users transfer tokens into the minting contract
- Does not rely on `approve`/`transfer_from` allowances

### Integration

- Oracle Contract: ACBU/USD and currency/USD rates
- Reserve Tracker: Reserve verification
- ACBU Token: Minting tokens
- USDC Token: Receiving deposits

---

## Burning Contract (`acbu_burning`)

Handles ACBU token redemption and triggers fiat withdrawals.

### Key Functions

- `initialize`: Configure admin, oracle, reserve tracker, tokens, and fees
- `burn_for_currency`: Burn ACBU for single currency redemption
- `burn_for_basket`: Burn ACBU for proportional basket redemption
- `redeem_single`: Redeem ACBU for single S-token
- `redeem_basket`: Redeem ACBU for basket of S-tokens
- `pause/unpause`: Emergency pause mechanism
- `set_fee_rate`: Update fee rates

### Token Transfer Model

- Uses pull model for S-token redemption
- Vault must grant contract allowance via `approve`
- Contract uses `transfer_from` to move tokens

### Integration

- Oracle Contract: Currency/USD rates
- Reserve Tracker: Reserve verification
- ACBU Token: Burning tokens
- Backend: Processing withdrawals via events

---

## Oracle Contract (`acbu_oracle`)

Aggregates exchange rates from multiple validators and provides rate data.

### Key Functions

- `initialize`: Set up validators, currencies, and basket weights
- `update_rate`: Update exchange rate (validator function)
- `get_rate`: Get current rate for a currency
- `get_acbu_usd_rate`: Get ACBU/USD rate (basket-weighted)
- `add_validator/remove_validator`: Manage validators

### Rate Calculation

- Median of 3 source rates
- Outlier detection (>3% deviation)
- Emergency updates (>5% moves)
- Basket-weighted ACBU/USD rate

### Access Control

- Update rates: Validators only (multisig)
- Read rates: Public
- Manage validators: Admin only

---

## Reserve Tracker Contract (`acbu_reserve_tracker`)

Tracks total reserves backing ACBU tokens across multiple currencies.

### Key Functions

- `initialize`: Configure admin and oracle
- `add_reserve`: Record reserve deposits
- `remove_reserve`: Record reserve withdrawals
- `is_sufficient`: Check if reserves are sufficient for supply
- `get_total_reserves_usd`: Get total reserves in USD

### Integration

- Used by Minting and Burning contracts for reserve verification
- Queries Oracle for currency rates

---

## Multisig Contract (`acbu_multisig`)

Provides multi-signature authorization for administrative actions.

### Key Functions

- `initialize`: Set up signers and threshold
- `propose`: Create new proposal
- `approve`: Approve proposal (signer function)
- `execute`: Execute approved proposal
- `add_signer/remove_signer`: Manage signers

### Security

- M-of-N threshold signatures
- Proposal expiry
- Nonce-based replay prevention

---

## Escrow Contract (`acbu_escrow`)

Manages escrowed funds for various use cases.

### Key Functions

- `initialize`: Configure admin and token
- `create_escrow`: Create new escrow
- `release_escrow`: Release funds to beneficiary
- `cancel_escrow`: Cancel and refund escrow
- `get_escrow`: Query escrow details

### Use Cases

- Payment escrow
- Conditional transfers
- Time-locked funds

---

## Lending Pool Contract (`acbu_lending_pool`)

Provides peer-to-peer lending functionality for ACBU tokens.

### Key Functions

- `initialize`: Configure admin and token
- `deposit`: Deposit ACBU into lending pool
- `withdraw`: Withdraw ACBU from lending pool
- `borrow`: Borrow ACBU from a specific lender's liquidity (borrower and lender
  must both authorize)
- `repay`: Repay borrowed ACBU

### Features

- Uncollateralized, single-asset lending: liquidity and principal are both ACBU
- Interest accrual
- Pool balance tracking

### Collateral policy

The pool takes no collateral. Posting ACBU against an ACBU loan locks at least as
much of the borrowed asset as it releases, so it extends no purchasing power and
gives the lender no protection; the earlier `collateral_amount >= amount` check
has been removed. Because the loan is unsecured, the lender bears the full credit
risk and must authorize each individual loan alongside the borrower.

`LoanData.collateral_amount` (always `0`) and error code `2014`
(`InsufficientCollateral`) are reserved for a future *distinct-asset* collateral
extension, which also requires oracle pricing and a liquidation path. No
`liquidate` entrypoint exists today: an unrepaid loan remains open in storage.

---

## Savings Vault Contract (`acbu_savings_vault`)

Provides interest-bearing savings accounts for ACBU tokens.

### Key Functions

- `initialize`: Configure admin, token, and interest rate
- `deposit`: Deposit ACBU to earn interest
- `withdraw`: Withdraw ACBU and accrued interest
- `lock`: Lock deposits for higher interest rates
- `get_balance`: Query balance and accrued interest

### Features

- Automatic interest accrual
- Lock periods for higher rates
- Emergency withdrawal with penalties

---

## Shared Library (`shared`)

Common types, utilities, and constants used across all contracts.

### Key Components

- `ContractError`: Standard error enum
- `CurrencyCode`: Currency type
- `DataKey`: Common storage keys
- `reentrancy_guard`: Re-entrancy protection
- Constants: `DECIMALS`, `BASIS_POINTS`, etc.

---

## Testing

All contracts include comprehensive test suites covering:

- Happy path scenarios
- Error conditions
- Edge cases
- Access control
- Reentrancy protection

Run tests with:

```bash
cargo test --workspace -- --nocapture
```

## Security

See [threat-model.md](threat-model.md) and [reentrancy-audit-c036.md](reentrancy-audit-c036.md) for security documentation.
