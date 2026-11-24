# ACBU Fee Policy Documentation

## Overview

The ACBU platform implements a dynamic fee structure that adjusts based on reserve health and currency-specific reserve weights. This document maps the code-level implementation to the business requirements.

**Fee Destination**: All fees are retained in protocol reserves to build and maintain the 103-105% over-collateralization target. See [fee-destination.md](./fee-destination.md) for detailed explanation of how fees contribute to reserve ratio math.

## Fee Types

### 1. Mint Fees

Mint fees are charged when users convert fiat currency to ACBU tokens. The fee adjusts based on the overall reserve ratio to discourage minting when reserves are stressed.

#### Fee Tiers

| Reserve Ratio | Fee (BPS) | Fee (%) | Business Logic |
|--------------|-----------|---------|----------------|
| ≥ 1.02 (minRatio) | 30 | 0.30% | Normal operations - healthy reserves |
| < 1.02 (minRatio) | 50 | 0.50% | Stressed reserves - discourage new minting |
| Maximum Cap | 100 | 1.00% | Hard cap to prevent excessive fees |

#### Code Constants

```typescript
// Location: src/services/feePolicy/feePolicyService.ts
const BASE_MINT_FEE_BPS = 30;           // Normal fee
const STRESSED_MINT_FEE_BPS = 50;       // Low reserve fee
const MAX_MINT_FEE_BPS = 100;           // Maximum cap
```

#### Implementation

```typescript
export async function getMintFeeBps(_currency?: string): Promise<number>
```

The function:
1. Calculates the current reserve ratio (total reserves / total ACBU supply)
2. Compares against `config.reserve.minRatio` (1.02)
3. Returns appropriate fee tier
4. Applies maximum cap
5. Validates fee is within sanity bounds [1, 500] BPS

### 2. Burn Fees

Burn fees are charged when users convert ACBU tokens back to fiat currency. The fee adjusts per currency based on that currency's reserve weight relative to its target weight in the basket.

#### Fee Tiers

| Reserve Weight (% of Target) | Fee (BPS) | Fee (%) | Business Logic |
|------------------------------|-----------|---------|----------------|
| < 85% | 200 | 2.00% | Low reserves - strongly discourage burns |
| 85% - 115% | 30 | 0.30% | Normal range - standard fee |
| > 115% | 5 | 0.05% | High reserves - encourage burns for rebalancing |

#### Code Constants

```typescript
// Location: src/services/feePolicy/feePolicyService.ts
const BASE_BURN_FEE_BPS = 30;           // Normal fee (85-115%)
const LOW_RESERVE_BURN_FEE_BPS = 200;   // Low reserve fee (<85%)
const HIGH_RESERVE_BURN_FEE_BPS = 5;    // High reserve fee (>115%)
const LOW_RESERVE_THRESHOLD_PCT = 85;   // Lower boundary
const HIGH_RESERVE_THRESHOLD_PCT = 115; // Upper boundary
```

#### Implementation

```typescript
export async function getBurnFeeBps(currency: string): Promise<number>
```

The function:
1. Retrieves current reserve status for the specified currency
2. Calculates `pctOfTarget = (actualWeight / targetWeight) * 100`
3. Applies appropriate fee tier based on thresholds
4. Validates fee is within sanity bounds [1, 500] BPS
5. Throws error if currency not found or target weight invalid

### 3. Spread

The spread is applied to exchange rates for buy/sell operations.

| Parameter | Value (BPS) | Value (%) | Description |
|-----------|-------------|-----------|-------------|
| Default Spread | 25 | 0.25% | Applied symmetrically to mid-rate |

#### Code Constants

```typescript
const DEFAULT_SPREAD_BPS = Number(process.env.SPREAD_BPS || "25");
```

#### Implementation

```typescript
export function applySpread(midRate: number): { buyRate: number; sellRate: number }
```

The function:
- Buy Rate: `midRate * (1 - spread/2)` - User pays slightly more
- Sell Rate: `midRate * (1 + spread/2)` - User receives slightly less

### 4. Merchant Payments & Acceptance Fees

Merchant checkout transactions follow a specialized fee model distinct from P2P transfers and remittance mint/burn corridors:

| Fee Component | Rate | Paid By | Recipient / Allocation | Description |
|---------------|------|---------|------------------------|-------------|
| **Payment Fee** | FREE (0.00%) | Payer / Customer | N/A | Customers paying merchants in ACBU pay zero platform fee |
| **Merchant Acceptance Fee** | 20 BPS (0.20%) | Merchant | ACBU Protocol Reserve / Treasury | Incurred by the merchant per accepted transaction; allocated to protocol operations, reserve maintenance, and ecosystem infrastructure |
| **Merchant Withdrawal (Burn)** | Dynamic (5–200 BPS; base 30 BPS / 0.30%) | Merchant | ACBU Protocol Reserve / Treasury | Standard burn fee applied when merchant liquidates ACBU to local fiat (e.g., 0.30% under normal reserve weights) |

#### Merchant-Flow Fee Assumption in Financial Projections

- **Remittance / Standard Flow (Two-Sided)**: User deposits fiat/USDC (mint fee: 0.30%) and recipient liquidates to fiat (burn fee: 0.30%), generating **0.60% (60 BPS)** in total per-tx volume revenue across both sides.
- **Merchant Flow (Corrected Projection)**:
  - Acceptance fee: **0.20% (20 BPS)** on transaction volume (payer side is FREE).
  - Off-ramp / withdrawal (optional/subsequent): When merchants liquidate ACBU into local fiat, standard withdrawal burn fee applies (typically **0.30% (30 BPS)** under normal 85–115% reserve levels).
  - **Total Per-Transaction Fee**: **0.20%** at payment point, or **0.50% (50 BPS)** total if merchant withdraws 100% of receipts immediately to fiat.
  - Projections must **not** assume 0.60% across all volume: merchant-flow transaction volume yields 0.20%–0.50% total fee revenue, preventing overstatement of merchant-flow revenue projections.

## Economic Incentives

### Mint Fee Logic

The mint fee structure creates the following incentives:

1. **Healthy Reserves (ratio ≥ 1.02)**: Low fee (30 BPS) encourages minting
2. **Stressed Reserves (ratio < 1.02)**: Higher fee (50 BPS) discourages minting until reserves recover

This protects the system from becoming under-collateralized.

**Fee Destination**: Mint fees are retained in protocol reserves. When a user deposits $100, the full $100 enters reserves but only $99.70 worth of ACBU is minted (assuming 30 BPS fee). This creates ~100.3% backing from each mint transaction, contributing to the 103-105% target reserve ratio.

### Burn Fee Logic

The burn fee structure creates currency-specific rebalancing incentives:

1. **Low Reserves (<85% of target)**: High fee (200 BPS / 2.00%) strongly discourages withdrawals of scarce currencies
2. **Normal Reserves (85-115%)**: Standard base fee (30 BPS / 0.30%) applies for normal operations
3. **High Reserves (>115%)**: Discounted low fee (5 BPS / 0.05%) encourages withdrawals to rebalance the basket

This automatically incentivizes users to help maintain the target basket composition.

**Fee Destination**: Burn fees are also retained in reserves, slightly increasing the reserve ratio when burns occur.

## Sanity Checks

All fee calculations include runtime sanity checks to prevent catastrophic errors:

```typescript
const MIN_SANITY_FEE_BPS = 1;    // 0.01% minimum
const MAX_SANITY_FEE_BPS = 500;  // 5.00% maximum
```

If a calculated fee falls outside this range, the service throws an error rather than returning an invalid fee.

## Testing Strategy

### Unit Tests

Standard unit tests verify:
- Correct fee for each tier
- Boundary conditions at exact thresholds
- Error handling for invalid inputs

Location: `src/services/feePolicy/__tests__/feePolicyService.test.ts`

### Property-Based Tests

Property-based tests verify mathematical properties:
- **Monotonicity**: Fees follow expected direction as reserves change
- **Boundaries**: Exact threshold behavior is consistent
- **Sanity**: All fees are within acceptable bounds
- **Determinism**: Same inputs always produce same outputs
- **Cap Enforcement**: Fees never exceed maximum limits

Location: `src/services/feePolicy/__tests__/feePolicyService.pbt.test.ts`

To run property-based tests:
```bash
pnpm add -D fast-check
pnpm test -- feePolicyService.pbt.test.ts
```

## Configuration

Fee parameters can be adjusted via environment variables:

```bash
# Spread (default: 25 BPS = 0.25%)
SPREAD_BPS=25

# Reserve thresholds (used by mint fee logic)
RESERVE_MIN_RATIO=1.02
RESERVE_TARGET_RATIO=1.05
RESERVE_ALERT_THRESHOLD=1.02
```

## Audit Trail

### Version History

| Date | Version | Changes | Auditor |
|------|---------|---------|---------|
| 2026-10-18 | 2.1 | Corrected merchant-flow fee assumption in projections (0.20%–0.50% vs 0.60%). Formally documented 0.20% acceptance fee and designated ACBU Protocol Reserve / Treasury as recipient. | Protocol / Financial Spec Review |
| 2026-04-25 | 2.0 | Fixed burn fee logic: Changed high reserve fee from 10 to 5 BPS. Added sanity checks. Added fail-fast error handling. | Senior Backend Engineer |
| 2026-01-29 | 1.0 | Initial implementation | - |

### Key Fixes in v2.0

1. **Burn Fee Correction**: High reserve tier (>115%) now correctly returns 5 BPS instead of 10 BPS
2. **Sanity Checks**: Added runtime validation to prevent fees outside [1, 500] BPS range
3. **Fail-Fast**: Service now throws errors for invalid states instead of returning default values
4. **Property-Based Testing**: Added comprehensive PBT suite to catch edge cases
5. **Documentation**: Created this mapping document for easier auditing

### Before and After

#### Burn Fee Logic (High Reserve Case)

**Before:**
```typescript
if (pctOfTarget > HIGH_RESERVE_THRESHOLD_PCT)
  return HIGH_RESERVE_BURN_FEE_BPS; // Was 10 BPS - WRONG!
```

**After:**
```typescript
if (pctOfTarget > HIGH_RESERVE_THRESHOLD_PCT) {
  // High reserves: encourage burns with low fee
  feeBps = HIGH_RESERVE_BURN_FEE_BPS; // Now 5 BPS - CORRECT!
}
```

**Impact**: Users with high-reserve currencies now pay 5 BPS instead of 10 BPS, correctly incentivizing rebalancing.

#### Error Handling

**Before:**
```typescript
if (!curr) return BASE_BURN_FEE_BPS; // Silent fallback
if (targetWeight <= 0) return BASE_BURN_FEE_BPS; // Silent fallback
```

**After:**
```typescript
if (!curr) {
  throw new Error(`Currency ${currency} not found in reserve status. Cannot calculate burn fee.`);
}
if (targetWeight <= 0) {
  throw new Error(`Invalid target weight for ${currency}: ${targetWeight}. Cannot calculate burn fee.`);
}
```

**Impact**: System now fails explicitly when encountering invalid states, preventing incorrect fee calculations.

### 4. KYC Application Fee

A one-time, non-refundable fee is charged when a user submits a KYC application.

| Fee | Amount | Currency | Refundable |
|-----|--------|----------|-----------|
| KYC application submission | 1 | ACBU | No |

The fee is deducted from the user's ACBU wallet balance at the moment the application is
submitted. It applies to all tiers (Tier 1, 2, and 3 applications). Re-submission after
rejection also incurs the full 1 ACBU fee.

**Revenue routing:** KYC application fees flow into the validator reward pool. They do
not contribute to protocol revenue or the treasury reserve.

#### Code Reference

```typescript
// Location: docs/KYC_LAYER.md — configuration table
feeAcbu = 1   // 1 ACBU per application (governance-adjustable from Year 3)
```

---

## Maintenance

When updating fee tiers:

1. Update constants in `src/services/feePolicy/feePolicyService.ts`
2. Update this documentation table
3. Update unit tests in `__tests__/feePolicyService.test.ts`
4. Run property-based tests to verify mathematical properties still hold
5. Update the audit trail with date, version, and changes
6. Review with financial/compliance team before deploying

## Contact

For questions about fee policy:
- Technical: Backend Engineering Team
- Business Logic: Product/Finance Team
- Compliance: Legal/Compliance Team
