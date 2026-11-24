# Treasury & Reserve Domain

## Description

The Treasury & Reserve domain manages the ACBU token's backing reserve and price oracle infrastructure. `Reserve` snapshots track the reserve composition by currency and segment. `ReserveHistory` provides an immutable change log tied to transactions. `OracleRate` aggregates multi-source FX rates. `AcbuRate` records the ACBU token price in multiple currencies. `BasketMetrics` and `BasketConfig` govern the statistical model that determines currency weights in the basket. `RebalancingEvent` tracks rebalancing operations triggered by drift or scheduled policy changes.

## Custodian concentration policy

Reserve custody must be diversified by region and provider. No custodian may be the primary custodian for more than one currency in a region, and no custodian may represent more than 35% of the approved basket's total reserve exposure. Each currency must have a documented secondary custodian or an approved, tested fallback before it is enabled for production minting or redemption. The treasury risk register records provider licenses, jurisdictions, limits, balances, and failover readiness.

The concentration limit is measured against current reserve value, not merely the number of currency assignments. A breach blocks new exposure to the affected custodian and raises a `RebalancingEvent`; it is not treated as diversification merely because the same provider is listed as secondary across additional currencies. Flutterwave therefore remains an available fintech rail, but it must not be the primary or fallback custodian for most of the basket.

---

## Entity-Relationship Diagram

```mermaid
erDiagram
    Transaction {
        uuid id PK
        string type
        string status
    }
    Reserve {
        uuid id PK
        string currency
        string segment
        decimal targetWeight
        decimal actualWeight
        decimal reserveAmount
        decimal reserveValueUsd
        datetime timestamp
    }
    ReserveHistory {
        uuid id PK
        uuid transactionId FK
        string currency
        decimal amountChange
        string reason
        decimal previousAmount
        decimal newAmount
        datetime timestamp
    }
    OracleRate {
        uuid id PK
        string currency
        decimal rateUsd
        decimal centralBankRate
        decimal fintechRate
        decimal forexRate
        decimal medianRate
        decimal twap24h
        datetime timestamp
    }
    AcbuRate {
        uuid id PK
        decimal acbuUsd
        decimal acbuNgn
        decimal acbuKes
        decimal acbuZar
        decimal acbuRwf
        decimal acbuGhs
        decimal acbuEgp
        decimal acbuMad
        decimal change24hUsd
        datetime timestamp
    }
    BasketMetrics {
        uuid id PK
        string currency
        string period
        decimal gdpScore
        decimal tradeScore
        decimal liquidityScore
        string source
    }
    BasketConfig {
        uuid id PK
        datetime effectiveFrom
        string currency
        decimal weight
        uuid proposalId
        string status
    }
    RebalancingEvent {
        uuid id PK
        string type
        string status
        json adjustments
        datetime startedAt
        datetime completedAt
    }

    Transaction ||--o{ ReserveHistory : "triggers"
    Reserve }o--|| Reserve : "unique(currency,segment,timestamp)"
    OracleRate }o--|| OracleRate : "unique(currency,timestamp)"
    BasketMetrics }o--|| BasketMetrics : "unique(currency,period)"
    BasketConfig }o--|| BasketConfig : "unique(effectiveFrom,currency)"
```

---

## Business Logic Notes

### Reserve snapshots
`Reserve` stores periodic snapshots of the reserve state. The `@@unique([currency, segment, timestamp])` constraint makes each row a point-in-time snapshot for a given `currency` + `segment` combination. `segment` distinguishes between `transactions` (operational reserve) and `investment_savings` (yield-generating capital). `targetWeight` vs `actualWeight` drives drift detection.

### ReserveHistory and Transaction linkage
`ReserveHistory.transactionId` FK links reserve changes back to the causative `Transaction` (defined in the Transactions & Payments domain). `reason` values — `mint`, `burn`, `rebalance`, `conversion` — classify the change type. `previousAmount` and `newAmount` provide a complete before/after record.

### OracleRate aggregation
Each `OracleRate` row aggregates rates from multiple sources for the same `currency` at a given `timestamp` (unique constraint). `centralBankRate`, `fintechRate`, and `forexRate` are the individual source inputs; `medianRate` is the consensus value used by the system; `twap24h` is the time-weighted average price over 24 hours for smoothing. `validatorSignatures` (omitted from diagram for clarity) stores cryptographic signatures from oracle validators. `rawValues.reviewRequired` marks an emergency update (a move beyond the 5% per-update limit) and `rawValues.deviationFromPreviousRate` records the size of the move — see [Oracle rate updates and the 5% deviation rule](../../oracle-rate-updates.md).

### AcbuRate price snapshots
`AcbuRate` records the ACBU token price in USD and a set of African currencies (NGN, KES, ZAR, RWF, GHS, EGP, MAD, TZS, UGX, XOF) at a point in time. `change24hUsd` is a pre-computed percentage change used by client apps for display.

### BasketMetrics derivation
`BasketMetrics` stores per-currency, per-period scores (GDP, trade volume, liquidity) sourced from external APIs and internal data. The `@@unique([currency, period])` constraint ensures one score set per currency per reporting period. These scores feed the weight calculation algorithm that produces `BasketConfig` proposals.

### BasketConfig lifecycle
`BasketConfig` rows represent proposed or active basket weight assignments. `status` progresses through `proposed` → `approved` → `active`. The `@@unique([effectiveFrom, currency])` constraint means there is exactly one weight per currency per effective date. The application layer reads the latest `active` rows to determine current basket composition.

### RebalancingEvent
`RebalancingEvent` records system-triggered or DAO-triggered rebalancing operations. `type` identifies the trigger (e.g., `drift_threshold`, `scheduled`, `emergency`). `adjustments` is a JSON object describing the buy/sell actions taken per currency. `completedAt` is null until the event finishes.

### Cross-domain note
`ReserveHistory.transactionId` references `Transaction` in the Transactions & Payments domain. Refer to [transactions-payments.md](./transactions-payments.md) for the full Transaction entity definition. `Transaction` is shown here with minimal fields for relationship context only.
