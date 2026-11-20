# Fee Destination and Reserve Math

## Issue Resolution: W10-DOC-002

This document clarifies the destination of fees and their impact on reserve ratio calculations, resolving the ambiguity identified in issue W10-DOC-002.

## Fee Destination

### Mint Fees (0.3% / 30 BPS)

**Destination**: Protocol reserves

When a user deposits fiat to mint ACBU:
- User deposits: $100.00
- Reserve receives: $100.00 (full deposit amount)
- User minted: $99.70 worth of ACBU (deposit minus fee)
- Fee retained: $0.30 (stays in protocol reserves)

**Result**: The reserve holds $100.00 while only $99.70 of ACBU is minted, creating ~100.3% backing ratio from this transaction alone.

### Burn Fees (varies: 5-200 BPS)

**Destination**: Protocol reserves

When a user burns ACBU to redeem fiat:
- User burns: $100.00 worth of ACBU
- Fee deducted: varies based on currency reserve level (see docs/fees.md)
- User receives: $100.00 - fee
- Reserve retains: fee amount

## Reserve Ratio Math

### Target: 103-105% Reserve Ratio

The protocol targets maintaining reserves between 103% and 105% of outstanding ACBU supply.

**Formula**:
```
Reserve Ratio = (Total Reserve Value USD / Total ACBU Supply USD) × 100%
```

### How Fees Contribute to Over-Collateralization

The 0.3% mint fee is the **primary mechanism** for building over-collateralization:

1. **Initial State**: Reserve ratio = 100% (hypothetically)
2. **User mints $1,000,000**:
   - Reserve receives: $1,000,000
   - ACBU minted: $997,000
   - New ratio: $1,000,000 / $997,000 = 100.3%
3. **Over time**: As more mints occur, fees accumulate
4. **Target reached**: After sufficient minting volume, ratio reaches 103-105%

### Reserve Ratio Triggers

- **≥ 102%**: Healthy reserves (30 BPS mint fee)
- **< 102%**: Stressed reserves (50 BPS mint fee - discourages new mints)

**Circuit Breaker**: If ratio falls below 102%, new minting is paused until reserves recover.

## Fee Revenue Accounting

Fees are **not** passed through to fintech partners. Fintech partner costs are handled separately through:
- Spread on exchange rates (25 BPS - see docs/fees.md)
- Operational overhead budgeting
- Partnership agreements

The 0.3% mint fee is **protocol revenue** that serves two purposes:
1. **Over-collateralization**: Build and maintain 103-105% reserve backing
2. **Protocol sustainability**: Cover operational costs, security audits, development

## Reconciliation

When reconciling reserves against obligations:

**Assets (Reserve Side)**:
- All deposited fiat currency holdings
- All yield from investment strategies
- All accumulated fees

**Liabilities (ACBU Side)**:
- Total ACBU supply × current ACBU/USD rate

**Target**: Assets should be 103-105% of Liabilities

## Examples

### Example 1: Clean Mint

User deposits 1,000 NGN when 1 NGN = $0.001:

1. Deposit value: 1,000 NGN = $1.00
2. Reserve receives: $1.00
3. Mint fee (30 BPS): $0.003
4. ACBU minted: $0.997 worth
5. Backing ratio from this tx: $1.00 / $0.997 = 100.3%

### Example 2: Clean Burn

User burns $1.00 of ACBU for NGN (normal reserves, 10 BPS fee):

1. ACBU burned: $1.00
2. Burn fee (10 BPS): $0.001
3. Reserve pays out: $0.999
4. Reserve retains: $0.001
5. Supply reduced by $1.00, reserves by $0.999
6. Effect on ratio: Slightly increases reserve ratio

### Example 3: Building to Target

Starting state: $0 reserves, 0 ACBU

- Mint #1: User deposits $1000 → Reserve: $1000, Supply: $997, Ratio: 100.3%
- Mint #2: User deposits $1000 → Reserve: $2000, Supply: $1994, Ratio: 100.3%
- (After many transactions with burns and operational costs)
- Steady state: Reserve: $10,000,000, Supply: $9,700,000, Ratio: 103%

## Implementation Notes

### Code Location

Fee collection happens in:
- `src/services/feePolicy/feePolicyService.ts` - Fee calculation
- `src/controllers/mintController.ts` - Mint flow (fee deducted from minted amount)
- `src/controllers/burnController.ts` - Burn flow (fee deducted from payout)

### Smart Contract Behavior

The Soroban smart contracts enforce:
- Fee is deducted **from user's received amount** (not from deposit)
- Full deposit enters reserve
- Only (deposit - fee) worth of ACBU is minted

This ensures fees automatically accrue to protocol reserves without separate transfer logic.

## Historical Note

**Issue W10-DOC-002** identified an ambiguity where the specification simultaneously claimed:
- §12.2: "0.3% covers fintech deposit costs" (implying pass-through to partners)
- §19.2: "0.3% × 2 sides counted as protocol revenue"
- §4.1: "targets 103-105% coverage" (requiring fees stay in reserves)

**Resolution**: Fees are protocol revenue retained in reserves. Fintech costs are covered through spreads and operational budgets, not through direct fee pass-through.

**Effective Date**: 2026-10-18

---

**References**:
- docs/fees.md - Fee tier structure
- ENV_VARS.md - Reserve ratio configuration
- src/services/feePolicy/feePolicyService.ts - Fee calculation implementation
