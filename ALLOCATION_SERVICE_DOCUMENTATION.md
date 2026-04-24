# Investment Allocation Service Documentation

**Version:** 1.0.0  
**Date:** 2026-04-24

---

## Overview

The Investment Allocation Service manages the deployment of capital from the `investment_savings` reserve segment into yield-bearing strategies. It enforces policy limits, tracks deployed notional, and prevents over-allocation.

---

## Key Concepts

### Deployed Notional

**Deployed notional** is the total USD value of capital currently allocated to a strategy. This value is:

- Stored in the `investment_strategies.deployed_notional_usd` database column
- Updated atomically when allocations or deallocations occur
- Used to calculate available capacity: `Available = Policy Limit - Deployed Notional`

### Policy Limit

Each strategy has a **policy limit** (`policy_limit_usd`) that defines the maximum USD amount that can be deployed. This limit is set by the protocol admin based on:

- Risk assessment of the strategy
- Liquidity constraints
- Diversification requirements

### Deployable Fraction

The `INVESTMENT_DEPLOYABLE_FRACTION` environment variable (default: 0.5) controls what percentage of the `investment_savings` reserve can be deployed across all strategies.

**Formula:**
```
Deployable from Reserve = Total Reserve Value × Deployable Fraction
Available to Deploy = Deployable from Reserve - Total Deployed Notional
```

---

## Architecture

### Database Schema

```sql
CREATE TABLE investment_strategies (
    id UUID PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    policy_limit_usd DECIMAL(20,2) NOT NULL,
    deployed_notional_usd DECIMAL(20,2) NOT NULL DEFAULT 0,
    target_apy_bps INTEGER,
    risk_tier VARCHAR(20) NOT NULL DEFAULT 'medium',
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### State Transitions

```
┌─────────────────────────────────────────────────────────────┐
│                    Investment Strategy                       │
│                                                              │
│  Policy Limit: $100,000                                     │
│  Deployed Notional: $0 → $50,000 → $90,000 → $50,000       │
│                                                              │
│  Operations:                                                 │
│  1. allocateToStrategy($50k)   → deployed = $50k            │
│  2. allocateToStrategy($40k)   → deployed = $90k            │
│  3. deallocateFromStrategy($40k) → deployed = $50k          │
└─────────────────────────────────────────────────────────────┘
```

---

## API Reference

### `computeDeployableAllocation()`

Returns aggregate allocation status across all active strategies.

**Returns:**
```typescript
interface AllocationSummary {
  segment: string; // "investment_savings"
  totalReserveValueUsd: string; // Decimal string
  deployableUsd: string; // Total deployable from reserve
  deployedUsd: string; // Currently deployed across all strategies
  availableToDeployUsd: string; // Remaining capacity
}
```

**Example:**
```typescript
const summary = await computeDeployableAllocation();
console.log(`Available: ${summary.availableToDeployUsd} USD`);
```

---

### `getStrategyAllocation(strategyId: string)`

Returns allocation status for a specific strategy.

**Parameters:**
- `strategyId`: UUID of the investment strategy

**Returns:**
```typescript
interface StrategyAllocation {
  strategyId: string;
  strategyName: string;
  policyLimitUsd: string; // Decimal string
  deployedNotionalUsd: string; // Currently deployed
  availableToDeployUsd: string; // Remaining capacity
  utilizationPercent: string; // (deployed / limit) × 100
}
```

**Errors:**
- Throws if strategy does not exist
- Throws if strategy is not active

**Example:**
```typescript
const allocation = await getStrategyAllocation(strategyId);
if (parseFloat(allocation.availableToDeployUsd) >= 10000) {
  // Sufficient capacity for $10k allocation
}
```

---

### `allocateToStrategy(strategyId: string, amountUsd: string)`

Reserves allocation capacity for a strategy. Updates `deployed_notional_usd` atomically.

**Parameters:**
- `strategyId`: UUID of the investment strategy
- `amountUsd`: Amount to allocate (Decimal string, e.g., "50000.00")

**Behavior:**
- Validates amount is positive
- Checks strategy is active
- Verifies allocation would not exceed policy limit
- Updates `deployed_notional_usd` in a transaction
- Rolls back on any error (atomic)

**Errors:**
- `PolicyViolationError`: Allocation would exceed limit
- `Error`: Strategy not found, inactive, or invalid amount

**Example:**
```typescript
try {
  await allocateToStrategy(strategyId, "50000.00");
  console.log("Allocation reserved");
} catch (error) {
  if (error instanceof PolicyViolationError) {
    console.error("Exceeds policy limit:", error.message);
  }
}
```

---

### `deallocateFromStrategy(strategyId: string, amountUsd: string)`

Releases allocation capacity when divesting from a strategy.

**Parameters:**
- `strategyId`: UUID of the investment strategy
- `amountUsd`: Amount to release (Decimal string)

**Behavior:**
- Validates amount is positive
- Reduces `deployed_notional_usd` (clamped to 0)
- Updates in a transaction

**Example:**
```typescript
await deallocateFromStrategy(strategyId, "20000.00");
console.log("Capacity released");
```

---

## Financial Math Safety

### Decimal Precision

All USD amounts use Prisma's `Decimal` type (backed by `decimal.js`), which provides:

- Arbitrary precision (no floating-point errors)
- String-based serialization
- Safe arithmetic operations

**❌ Never do this:**
```typescript
const available = policyLimit - deployed; // WRONG: uses Number
```

**✅ Always do this:**
```typescript
const available = policyLimit.sub(deployed); // CORRECT: uses Decimal
```

### Common Operations

```typescript
import { Decimal } from "@prisma/client/runtime/library";

// Addition
const total = new Decimal("50000.00").add(new Decimal("30000.00"));
// → Decimal("80000.00")

// Subtraction
const remaining = new Decimal("100000.00").sub(new Decimal("60000.00"));
// → Decimal("40000.00")

// Multiplication
const deployable = new Decimal("200000.00").mul(new Decimal("0.5"));
// → Decimal("100000.00")

// Division
const utilization = new Decimal("60000.00").div(new Decimal("100000.00"));
// → Decimal("0.6")

// Comparison
if (deployed.gt(limit)) {
  throw new Error("Exceeds limit");
}

// Conversion to string
const usdString = amount.toFixed(2); // "50000.00"
```

---

## Scenarios

### Scenario A: Non-Zero State (Warm Start)

**Setup:**
- Policy Limit: $100,000
- Already Deployed: $50,000
- Attempt to allocate: $60,000

**Expected Behavior:**
```typescript
await allocateToStrategy(strategyId, "60000.00");
// ❌ Throws PolicyViolationError
// Available: $50,000 (limit - deployed)
// Requested: $60,000
// Exceeds available by: $10,000
```

**Correct Allocation:**
```typescript
await allocateToStrategy(strategyId, "50000.00");
// ✅ Success: deployed = $100,000 (at limit)
```

---

### Scenario B: Full Utilization

**Setup:**
- Policy Limit: $100,000
- Already Deployed: $100,000

**Expected Behavior:**
```typescript
await allocateToStrategy(strategyId, "1000.00");
// ❌ Throws PolicyViolationError
// Available: $0.00
// Strategy is at full capacity
```

**Resolution:**
1. Deallocate from the strategy to free capacity
2. Increase the policy limit (admin action)
3. Use a different strategy

---

### Scenario C: Decimal Precision

**Setup:**
- Allocate $33,333.33 three times

**Expected Behavior:**
```typescript
await allocateToStrategy(strategyId, "33333.33");
// deployed = $33,333.33

await allocateToStrategy(strategyId, "33333.33");
// deployed = $66,666.66

await allocateToStrategy(strategyId, "33333.33");
// deployed = $99,999.99

// No floating-point errors: 33333.33 + 33333.33 + 33333.33 = 99999.99
```

---

## Testing

### Running Tests

```bash
# Run allocation tests
pnpm test allocation.test.ts

# Run with coverage
pnpm test:coverage allocation.test.ts
```

### Test Coverage

The test suite covers:

- ✅ Cold start (zero deployed)
- ✅ Warm start (non-zero deployed)
- ✅ Full utilization (deployed >= limit)
- ✅ Decimal precision (no floating-point errors)
- ✅ Policy violation enforcement
- ✅ Atomicity (transaction rollback)
- ✅ Edge cases (negative, zero, inactive strategy)
- ✅ Multiple strategies
- ✅ Deallocation

**Target:** ≥95% line coverage

---

## Deployment

### Database Migration

```bash
# Apply migration
pnpm prisma:migrate:deploy

# Seed strategies
ts-node prisma/seedStrategies.ts
```

### Environment Variables

```bash
# Deployable fraction (0-1, default 0.5)
INVESTMENT_DEPLOYABLE_FRACTION=0.5
```

---

## Monitoring

### Key Metrics

1. **Utilization Rate**: `deployed_notional_usd / policy_limit_usd`
   - Alert if > 90% (approaching limit)

2. **Available Capacity**: `policy_limit_usd - deployed_notional_usd`
   - Alert if < $10,000 (low capacity)

3. **Total Deployed**: Sum of `deployed_notional_usd` across all strategies
   - Compare to `deployableUsd` from reserve

### Queries

```sql
-- Strategy utilization
SELECT
  name,
  policy_limit_usd,
  deployed_notional_usd,
  (deployed_notional_usd / policy_limit_usd * 100) AS utilization_percent
FROM investment_strategies
WHERE status = 'active'
ORDER BY utilization_percent DESC;

-- Total deployed vs. deployable
SELECT
  SUM(deployed_notional_usd) AS total_deployed
FROM investment_strategies
WHERE status = 'active';
```

---

## Security Considerations

### Trust Boundaries

- **Admin**: Can create strategies and set policy limits
- **Allocation Service**: Can allocate/deallocate within limits
- **Database**: Source of truth for deployed notional

### Failure Modes

| Failure Mode | Risk | Mitigation |
|--------------|------|------------|
| Over-allocation | Exceeds policy limit | Atomic transaction with validation |
| Floating-point errors | Incorrect calculations | Use Decimal type for all USD amounts |
| Concurrent allocations | Race condition | Database transaction isolation |
| Stale deployed notional | Incorrect available capacity | Always fetch from DB, never cache |

### Audit Trail

All allocation/deallocation operations should be logged to `audit_trail`:

```typescript
await prisma.auditTrail.create({
  data: {
    eventType: "investment_allocation",
    entityType: "investment_strategy",
    entityId: strategyId,
    action: "allocate",
    oldValue: { deployedNotionalUsd: oldDeployed.toString() },
    newValue: { deployedNotionalUsd: newDeployed.toString() },
    performedBy: adminUserId,
  },
});
```

---

## Future Enhancements

1. **Rebalancing**: Automatically rebalance across strategies based on APY
2. **Yield Tracking**: Link deployed notional to yield accounting
3. **Risk Limits**: Enforce aggregate risk limits across risk tiers
4. **Historical Tracking**: Track deployed notional over time for analytics
5. **Alerts**: Notify admin when utilization exceeds thresholds

---

## References

- [Prisma Decimal Documentation](https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-decimal)
- [decimal.js Documentation](https://mikemcl.github.io/decimal.js/)
- Reserve Tracker: `src/services/reserve/ReserveTracker.ts`
- Yield Accounting: `src/services/investment/yieldAccountingService.ts`
