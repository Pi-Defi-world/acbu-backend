# Oracle Rate Updates and the 5% Deviation Rule

This document defines how FX/oracle rate updates are admitted, and settles the
contradiction reported in **W10-DOC-014** between the two rate-update paths:

- an "emergency update triggered if any currency moves >5%", and
- `update_rate` rejecting moves >5% "without a review flag".

The two statements describe the same rule from different sides. A move larger
than the deviation limit **is** an emergency update, and an emergency update
**sets the review flag** — it is neither rejected outright nor exempt from the
limit. No path may use a >5% move to bypass the rate-limit window without that
flag.

## 1. One limit for every path

| Layer                          | Setting                                                                         | Default        |
| ------------------------------ | ------------------------------------------------------------------------------- | -------------- |
| On-chain (`acbu_oracle`)       | `EMERGENCY_THRESHOLD_BPS` (per-currency override via `set_emergency_threshold`) | `500` bps = 5% |
| Backend (`fetchAndStoreRates`) | `ORACLE_MAX_DEVIATION_PER_UPDATE`                                               | `0.05` = 5%    |
| Backend circuit breaker        | `ORACLE_CIRCUIT_BREAKER_THRESHOLD`                                              | `0.10` = 10%   |

Deviation is measured against the last stored rate for the currency:
`|new - previous| / previous`.

- `deviation <= 5%` — an ordinary update; no review flag.
- `deviation > 5%` — an **emergency update** when it falls inside the update
  interval. The review flag is set before the update is applied; the update does
  not bypass the limit, the flag is what lets it proceed under review.

## 2. Normal validator path — `update_rate`

Validators submit rates; the contract applies quorum, median aggregation and
outlier rejection, and rate-limits writes to `UPDATE_INTERVAL_SECONDS`
(6 hours).

- A move at or below 5% follows the normal interval rules.
- Once the interval has elapsed, the update is admitted as usual regardless of
  the size of the move.
- A move above 5% *inside* the interval is an emergency update. It is accepted
  only when at least `min_signatures` validators have independently cast
  emergency votes via `cast_emergency_vote` — that vote set is the on-chain
  review flag. Without it the call fails with `UpdateIntervalNotMet`; with it
  the committing call emits `EmergencyBypassEvent`.
- `EMERGENCY_UPDATE_COOLDOWN_SECONDS` still applies to emergency updates, and
  no update may roll the stored timestamp backwards.

## 3. Emergency/admin path — `set_rate_admin`

`set_rate_admin` is the deliberate override used by the backend's
`OracleService.updateRate` (see `src/services/contracts/acbuOracle.service.ts`)
when an operator needs to publish a rate directly.

- The first write for a currency (bootstrap) is unrestricted.
- Once a rate exists, the update interval must have elapsed **and** the move may
  not exceed the 5% emergency threshold. A larger move is rejected with
  `AdminDeviationTooLarge` (7026) and must go through the
  `cast_emergency_vote` + `update_rate` path above.

The admin path therefore never exempts an emergency move from review; it
matches the validator path's 5% rule.

## 4. Backend behaviour (`fetchAndStoreRates`)

`src/services/oracle/integrationService.ts` computes the composite rate, then:

1. Calls `assessRateDeviation(previousRate, newRate, maxDeviation)`.
2. If the move exceeds `ORACLE_CIRCUIT_BREAKER_THRESHOLD`, replaces the
   published value with the 48-hour average (circuit breaker).
3. If the raw move exceeded `ORACLE_MAX_DEVIATION_PER_UPDATE`, sets the review
   flag and logs `Oracle: emergency rate update flagged for review` with
   `reviewRequired: true`.
4. Persists the rate with both values in `OracleRate.rawValues`:
   - `deviationFromPreviousRate` — relative size of the raw move (or `null`
     when there is no previous rate),
   - `reviewRequired` — `true` for emergency updates, `false` otherwise.

The flag is recorded against the raw market move, before circuit-breaker
smoothing, so operators can see the event that triggered the emergency. It does
not block the write: the on-chain contract enforces its own deviation limit and
emergency consensus, while the backend flag drives review and alerting.

## 5. Consistency statement (W10-DOC-014)

> Emergency updates are triggered by any currency moving more than 5% inside
> the update interval. They set the review flag — on-chain via N-of-M emergency
> votes, in the backend via `OracleRate.rawValues.reviewRequired` — and are then
> admitted under the same 5% rule as ordinary validator updates. No update path
> may use a >5% move to bypass the interval without a review flag.

## See also

- `ENV_VARS.md` — `ORACLE_MAX_DEVIATION_PER_UPDATE`,
  `ORACLE_CIRCUIT_BREAKER_THRESHOLD`
- `src/services/oracle/integrationService.ts` — `assessRateDeviation`
- `docs/architecture/domains/treasury-reserve.md` — `OracleRate` aggregation
