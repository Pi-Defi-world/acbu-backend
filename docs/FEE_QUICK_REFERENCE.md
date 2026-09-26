# ACBU Fee Policy - Quick Reference Card

## Mint Fees (Fiat → ACBU)

| Condition | Fee | When to Apply |
|-----------|-----|---------------|
| **Normal** | **30 BPS** (0.30%) | Reserve ratio ≥ 1.02 |
| **Stressed** | **50 BPS** (0.50%) | Reserve ratio < 1.02 |
| **Maximum Cap** | **100 BPS** (1.00%) | Hard limit |

**Code Location**: `src/services/feePolicy/feePolicyService.ts` → `getMintFeeBps()`

**Example**:
- User mints $1,000 ACBU with healthy reserves (ratio = 1.05)
- Fee: $1,000 × 0.0030 = $3.00
- User receives: $997.00 worth of ACBU

---

## Burn Fees (ACBU → Fiat)

| Reserve Level | Fee | When to Apply |
|---------------|-----|---------------|
| **Low** (<85% of target) | **200 BPS** (2.00%) | Discourage burns |
| **Normal** (85-115% of target) | **30 BPS** (0.30%) | Standard operations |
| **High** (>115% of target) | **5 BPS** (0.05%) | Encourage burns |

**Code Location**: `src/services/feePolicy/feePolicyService.ts` → `getBurnFeeBps(currency)`

**Example 1 - Low Reserve**:
- NGN reserves at 80% of target (LOW)
- User burns $1,000 ACBU for NGN
- Fee: $1,000 × 0.0200 = $20.00
- User receives: $980.00 worth of NGN

**Example 2 - High Reserve**:
- NGN reserves at 120% of target (HIGH)
- User burns $1,000 ACBU for NGN
- Fee: $1,000 × 0.0005 = $0.50
- User receives: $999.50 worth of NGN

---

## Spread (Exchange Rate Adjustment)

| Parameter | Value | Application |
|-----------|-------|-------------|
| **Default Spread** | **25 BPS** (0.25%) | Applied to buy/sell rates |

**Code Location**: `src/services/feePolicy/feePolicyService.ts` → `applySpread(midRate)`

**Formula**:
- Buy Rate (user buys ACBU): `midRate × (1 - 0.00125)`
- Sell Rate (user sells ACBU): `midRate × (1 + 0.00125)`

**Example**:
- Mid rate: 1 ACBU = 1,000 NGN
- Buy rate: 998.75 NGN per ACBU (user pays more)
- Sell rate: 1,001.25 NGN per ACBU (user receives less)

---

## Sanity Bounds

All fees must be within:
- **Minimum**: 1 BPS (0.01%)
- **Maximum**: 500 BPS (5.00%)

If a calculated fee falls outside this range, the system throws an error.

---

## Fee Calculation Examples

### Scenario 1: Normal Mint
- Reserve ratio: 1.05 (healthy)
- Amount: $10,000
- Fee: 30 BPS = $30.00
- User receives: $9,970.00 worth of ACBU

### Scenario 2: Stressed Mint
- Reserve ratio: 1.01 (below minimum)
- Amount: $10,000
- Fee: 50 BPS = $50.00
- User receives: $9,950.00 worth of ACBU

### Scenario 3: Normal Burn (NGN at 100% of target)
- Reserve level: Normal
- Amount: $10,000 ACBU
- Fee: 30 BPS = $30.00
- User receives: $9,970.00 worth of NGN

### Scenario 4: Low Reserve Burn (NGN at 70% of target)
- Reserve level: Low
- Amount: $10,000 ACBU
- Fee: 200 BPS = $200.00
- User receives: $9,800.00 worth of NGN

### Scenario 5: High Reserve Burn (NGN at 130% of target)
- Reserve level: High
- Amount: $10,000 ACBU
- Fee: 5 BPS = $5.00
- User receives: $9,995.00 worth of NGN

---

## Economic Incentives

### Mint Fees
- ✅ **Low fee when healthy**: Encourages minting when system is well-collateralized
- ⚠️ **Higher fee when stressed**: Discourages minting when reserves are low

### Burn Fees
- 🔴 **High fee for scarce currencies**: Protects low-reserve currencies from depletion
- ✅ **Low fee for abundant currencies**: Encourages rebalancing by making burns cheaper
- 🎯 **Normal fee for balanced currencies**: Standard operations

---

## Threshold Reference

### Burn Fee Thresholds

```
Reserve Weight (% of Target)
    0%        85%       115%      200%
    |---------|---------|---------|
    |   200   |   30    |    5    |
    |   BPS   |   BPS   |   BPS   |
    |---------|---------|---------|
     LOW      NORMAL     HIGH
```

### Mint Fee Threshold

```
Reserve Ratio
    0.0       1.02      2.0
    |---------|---------|
    |   50    |   30    |
    |   BPS   |   BPS   |
    |---------|---------|
   STRESSED   NORMAL
```

---

## Code Constants

```typescript
// Mint Fees
const BASE_MINT_FEE_BPS = 30;
const STRESSED_MINT_FEE_BPS = 50;
const MAX_MINT_FEE_BPS = 100;

// Burn Fees
const BASE_BURN_FEE_BPS = 30;
const LOW_RESERVE_BURN_FEE_BPS = 200;
const HIGH_RESERVE_BURN_FEE_BPS = 5;

// Thresholds
const LOW_RESERVE_THRESHOLD_PCT = 85;
const HIGH_RESERVE_THRESHOLD_PCT = 115;

// Spread
const DEFAULT_SPREAD_BPS = 25;

// Sanity Bounds
const MIN_SANITY_FEE_BPS = 1;
const MAX_SANITY_FEE_BPS = 500;
```

---

## Testing

Run tests to verify fee calculations:

```bash
# Unit tests
pnpm test -- feePolicyService.test.ts

# Property-based tests
pnpm test -- feePolicyService.pbt.test.ts

# All tests with coverage
pnpm run test:coverage
```

---

## Documentation

- **Full Documentation**: `docs/fees.md`
- **Audit Summary**: `FEE_AUDIT_SUMMARY.md`
- **Installation Guide**: `INSTALLATION_GUIDE.md`
- **Code**: `src/services/feePolicy/feePolicyService.ts`

---

## Quick Decision Tree

### For Mint Operations:
1. Check reserve ratio
2. If ratio ≥ 1.02 → 30 BPS
3. If ratio < 1.02 → 50 BPS
4. Apply cap (max 100 BPS)

### For Burn Operations:
1. Get currency's actual weight and target weight
2. Calculate: `pctOfTarget = (actualWeight / targetWeight) × 100`
3. If pctOfTarget < 85% → 200 BPS
4. If pctOfTarget > 115% → 5 BPS
5. Otherwise → 10 BPS

---

**Last Updated**: 2026-04-25  
**Version**: 2.0  
**Auditor**: Senior Backend Engineer
