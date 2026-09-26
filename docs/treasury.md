# Enterprise Treasury System Documentation

## Overview

The Treasury System provides a robust, verified view of enterprise reserve balances across multiple currencies and segments. It implements join-and-reconcile logic to aggregate data from three primary sources and verify consistency against ledger totals.

### Key Features

- **Verified Totals**: Reconciliation engine ensures calculated totals match ledger balances within tolerance
- **Null Handling**: COALESCE-like logic defaults to 0 for missing data points
- **FX Fallback**: Uses most recent available FX rate if current snapshot missing
- **Multi-Segment Support**: Separate tracking for transaction and investment/savings segments
- **Enterprise-Grade**: Optimized for millions of transactions across 50+ currencies

---

## Data Model

### Primary Data Sources

#### 1. Transfers (Transactions Table)

Records all mint, burn, and transfer operations affecting treasury:

```sql
SELECT 
  type,
  local_currency,
  usdc_amount,
  status,
  created_at
FROM transactions
WHERE status IN ('completed', 'processing')
  AND type IN ('mint', 'burn', 'transfer')
```

**Aggregation Logic**:
- `MINT` operations: Add `usdc_amount` to minted total (USD value minted)
- `BURN` operations: Subtract `usdc_amount` from balance (USD value burned)
- `TRANSFER` operations: Add `usdc_amount` as net movement (USD value transferred)
- Results grouped by currency, all values in USD

#### 2. Reserves (Reserves Table)

Current holdings by currency and segment:

```sql
SELECT 
  currency,
  segment,
  reserve_amount,
  reserve_value_usd,
  timestamp
FROM reserves r
WHERE (r.currency, r.segment, r.timestamp) IN (
  SELECT currency, segment, MAX(timestamp)
  FROM reserves
  GROUP BY currency, segment
)
```

**Segments**:
- `transactions`: Liquidity for operational transfers (primary)
- `investment_savings`: Locked reserves for investment/yield programs

#### 3. FX Snapshots (OracleRate Table)

Exchange rates for converting local currency amounts to USD:

```sql
SELECT 
  currency,
  rate_usd,
  timestamp
FROM oracle_rates
WHERE currency = ?
ORDER BY timestamp DESC
LIMIT 1
```

---

## Treasury Calculation

### Source of Truth Hierarchy

The system uses the following precedence when resolving data:

1. **Ledger (Reserves)** - Authoritative current balance
   - Represents actual custody amounts
   - Updated periodically from fintech partners and on-chain sources
   - Used as the reference for reconciliation

2. **Calculated Total (Transactions)** - Derived aggregate
   - Sum of all minted, burned, and transferred amounts
   - Verified against ledger for consistency
   - If discrepancy exceeds tolerance, warning logged but ledger total used

3. **Discrepancy** - Tracked for audit
   - Logged with high priority if exceeds tolerance
   - May indicate transaction batching delays or rounding differences

### Calculation Flow

```
1. Load Latest Reserves by Currency + Segment
   ├─ Get most recent (currency, segment, timestamp)
   ├─ If none found: default to 0
   └─ Store in map: `{currency}:{segment}` → {amount, valueUsd}

2. Fetch FX Rates
   ├─ For each currency, try current rate
   ├─ If missing, fallback to rate from last 7 days
   ├─ If still missing, use rate = 1 (no conversion)
   └─ Track source: current | fallback | zero

3. Aggregate Transactions
   ├─ Group by local_currency
   ├─ Sum minted - burned + transferred (all from usdc_amount, in USD)
   └─ Store calculatedTotalUsd per currency

4. Reconcile
   ├─ Ledger Total (USD) = Sum of all reserve_value_usd
   ├─ Calculated Total (USD) = Sum of net usdc_amount transactions per currency
   ├─ Discrepancy % = |Ledger - Calculated| / Ledger * 100
   └─ isReconciled = Discrepancy % ≤ Tolerance %

5. Return Treasury Response
   ├─ totalBalanceUsd (ledger-verified)
   ├─ byCurrency breakdown
   ├─ Segment details (transactions, investmentSavings)
   └─ Reconciliation status + warnings
```

### Null Handling (COALESCE Logic)

When a new reserve segment has no data yet:

```typescript
// Before aggregation:
if (reserve === null) {
  reserveAmount = 0;
  reserveValueUsd = 0;
  fxRateSource = 'zero'; // Explicitly mark as missing
} else {
  // Use actual value
}

// Result: No NaN, null, or undefined values in response
```

---

## Reconciliation Engine

### Tolerance Logic

The system allows a strictly defined tolerance to account for:
- Rounding in FX conversions (precision at 2 decimal places)
- Batching delays (transactions posted vs. reserves updated at different times)
- Oracle rate latency (snapshot taken before/after transaction recorded)

**Default Tolerance**: 0.01% (0.0001 as decimal)

**Custom Tolerance**: Adjustable per request via `?tolerance=0.05` parameter

### Reconciliation Result

```typescript
interface ReconciliationResult {
  ledgerTotal: number;           // Sum of reserves in USD
  calculatedTotal: number;       // Sum of net transactions
  discrepancy: number;           // |ledger - calculated|
  discrepancyPercentage: number; // (discrepancy / ledger) * 100
  isReconciled: boolean;         // discrepancy % ≤ tolerance %
  tolerancePercentage: number;   // Configured threshold
  warnings: string[];            // High-priority alerts if not reconciled
}
```

### Logging

- **Success** (isReconciled = true): INFO level
- **Within Tolerance** (discrepancy > 0 but < tolerance): WARN level with %age
- **Failed** (isReconciled = false): ERROR level with full details

---

## FX Fallback Strategy

### Current Rate (Primary)

```sql
SELECT rate_usd, timestamp
FROM oracle_rates
WHERE currency = 'NGN'
ORDER BY timestamp DESC
LIMIT 1
```

### Fallback Rate (Secondary)

If current rate missing, look back up to 7 days:

```sql
SELECT rate_usd, timestamp
FROM oracle_rates
WHERE currency = 'NGN'
  AND timestamp >= NOW() - INTERVAL '7 days'
ORDER BY timestamp DESC
LIMIT 1
```

### Zero Rate (Tertiary)

If no rate found in last 7 days:
- Use fxRate = 1 (no conversion)
- Mark as `fxRateSource = 'zero'`
- Log warning: "No FX rate available for {currency}, using rate=1"

### Response Format

Each segment includes FX metadata:

```json
{
  "currency": "NGN",
  "segment": "transactions",
  "amount": 1000000,
  "valueUsd": 667.50,
  "fxRate": 0.000667,
  "fxRateTimestamp": "2026-04-26T10:30:00Z",
  "fxRateSource": "current|fallback|zero"
}
```

---

## API Endpoint

### GET /treasury

Returns verified enterprise treasury with reconciliation status.

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tolerance` | float | `0.01` | Reconciliation tolerance in percentage (0-100) |

#### Response (200 OK)

```json
{
  "totalBalanceUsd": 5000.00,
  "totalReserveAmount": 1500000,
  "summary": {
    "transactionsSegmentUsd": 3000.00,
    "investmentSavingsSegmentUsd": 2000.00
  },
  "byCurrency": [
    {
      "currency": "NGN",
      "targetWeight": 18.0,
      "reserveAmount": 800000,
      "reserveValueUsd": 533.33,
      "segments": {
        "transactions": {
          "amount": 500000,
          "valueUsd": 333.33,
          "fxRate": 0.000667,
          "fxRateTimestamp": "2026-04-26T10:30:00Z",
          "fxRateSource": "current"
        },
        "investmentSavings": {
          "amount": 300000,
          "valueUsd": 200.00,
          "fxRate": 0.000667,
          "fxRateTimestamp": "2026-04-26T10:30:00Z",
          "fxRateSource": "current"
        }
      }
    }
  ],
  "reconciliation": {
    "ledgerTotal": 5000.00,
    "calculatedTotal": 5000.00,
    "discrepancy": 0.00,
    "discrepancyPercentage": 0.00,
    "isReconciled": true,
    "tolerancePercentage": 0.01,
    "warnings": []
  },
  "message": "Treasury reconciliation successful"
}
```

#### Error Response (500 Internal Server Error)

```json
{
  "error": "INTERNAL_SERVER_ERROR",
  "message": "Treasury calculation failed",
  "details": "Database connection timeout"
}
```

---

## Database Indexes

### Query Performance Optimization

The following indexes support enterprise-scale queries:

#### 1. Reserve Lookups (DISTINCT by currency + segment)

```sql
CREATE INDEX idx_reserves_currency_segment_timestamp
ON reserves(currency, segment, timestamp DESC);
```

- Query: `SELECT DISTINCT (currency, segment) FROM reserves ORDER BY timestamp DESC`
- Expected: ~10-50ms for 10 currencies

#### 2. FX Rate Lookups (Current + Fallback)

```sql
CREATE INDEX idx_oracle_rates_currency_timestamp_desc
ON oracle_rates(currency, timestamp DESC);
```

- Query: `SELECT rate_usd FROM oracle_rates WHERE currency = ? ORDER BY timestamp DESC`
- Expected: ~5-15ms per lookup

#### 3. Transaction Aggregation

```sql
CREATE INDEX idx_transactions_type_currency
ON transactions(type, local_currency, status);
```

- Query: `SELECT SUM(amount) FROM transactions WHERE type IN (...) AND local_currency = ?`
- Expected: ~50-200ms for 1M rows

#### 4. Reserve Status Check

```sql
CREATE INDEX idx_reserves_segment_timestamp
ON reserves(segment, timestamp DESC);
```

- Query: `SELECT * FROM reserves WHERE segment = ? ORDER BY timestamp DESC`
- Expected: ~10-30ms

### Estimated End-to-End Performance

| Scenario | Currencies | Transactions | Expected Time |
|----------|-----------|--------------|---------------|
| Small deployment | 5 | 10K | ~100ms |
| Medium deployment | 10 | 100K | ~250ms |
| Enterprise deployment | 50 | 1M | ~500ms |
| Large enterprise | 50 | 10M | ~1-2s |

Measurements taken with indexes in place and query caching enabled.

---

## Error Handling

### Common Scenarios

#### Missing FX Rate

**Behavior**: Falls back to most recent rate; if none available, uses rate=1

**Logging**: WARN level with currency and age of fallback

```
WARN: Using fallback FX rate for currency NGN (3 days old)
```

#### Reconciliation Failure

**Behavior**: Logs ERROR, includes warning in response, returns ledger-verified total

**Logging**: ERROR level with full discrepancy details

```
ERROR: Treasury reconciliation FAILED: 
  Ledger Total USD 1000.00 vs Calculated Total USD 1100.00
  Discrepancy 10.0000% (tolerance: 0.01%)
```

#### Database Failure

**Behavior**: Propagates to error handler; client receives 500 error

**Logging**: ERROR level with exception details

```
ERROR: Treasury calculation failed - Database connection timeout
```

---

## Testing Strategy

### Unit Tests

- **Null Handling**: Verify defaults to 0 for missing reserves/transactions
- **FX Fallback**: Mock missing current rate, verify fallback to 7-day history
- **Reconciliation**: Test tolerance boundaries (within/exceeded)
- **Edge Cases**: Zero amounts, very large amounts, missing currencies

### Integration Tests

- **Multi-Currency**: Aggregates correctly with 10+ currencies
- **Multi-Segment**: Transactions and investment segments calculated separately
- **Consistency**: Run treasury calc twice, verify same result within tolerance

### Load Tests

- **1M Transactions**: Complete in < 2s
- **50 Currencies**: Complete in < 500ms
- **Query Efficiency**: No full table scans (verified via EXPLAIN PLAN)

---

## Deployment Checklist

Before deploying to production:

- [ ] Run migration: `prisma migrate deploy`
- [ ] Verify indexes created: `SELECT * FROM pg_indexes WHERE tablename IN ('reserves', 'oracle_rates', 'transactions')`
- [ ] Run test suite: `pnpm test -- src/services/treasury/`
- [ ] Load test with production data size
- [ ] Configure tolerance based on SLA requirements
- [ ] Monitor logs for reconciliation failures in first 24h
- [ ] Set up alerts for reconciliation failure rate > 5%

---

## Maintenance

### Monitoring

Add metrics collection:

```typescript
// Log treasury health metrics periodically
const health = await getTreasuryHealth();
metrics.gauge('treasury.balance.usd', health.totalBalanceUsd);
metrics.gauge('treasury.reconciled', health.healthy ? 1 : 0);
metrics.gauge('treasury.warning.count', health.warnings.length);
```

### Data Retention

- **Transactions**: Keep indefinitely (audit trail)
- **Reserves**: Keep last 90 days of snapshots
- **OracleRates**: Keep indefinitely (historical rates for analysis)

### Troubleshooting

**High Reconciliation Failures**:
1. Check FX rate freshness (should be < 1 hour old)
2. Verify transaction timestamps match reserve timestamps
3. Check for pending transactions not yet marked as completed
4. Review tolerance threshold (may need adjustment for market volatility)

**Performance Degradation**:
1. Check index fragmentation (rebuild if > 30% fragmented)
2. Analyze query plans with `EXPLAIN (ANALYZE, BUFFERS)`
3. Consider archiving old transactions
4. Increase database connection pool

---

## References

- **TreasuryService.ts**: Core business logic
- **enterpriseController.ts**: HTTP endpoint
- **TreasuryService.test.ts**: Unit tests (40+ test cases)
- **enterpriseController.test.ts**: Integration tests

For implementation details, see source code comments.
