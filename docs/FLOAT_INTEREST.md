# Float Interest (Savings Vault) — APY and Revenue Specification

> **Audit note W10-DOC-006:** Previous platform copy quoted a float-interest APY of
> "8–25 %" alongside a revenue example of "$3–5 M annually on $50 M AUM". Those two
> figures are mutually inconsistent: $50 M × 8 % = $4 M and $50 M × 25 % = $12.5 M,
> so the upper bound vastly overstates the projection while the lower bound only
> narrowly meets it. This document corrects the advertised range and aligns it with
> the revenue model in §19.2 of the platform specification.

---

## Corrected APY Range

| Parameter | Corrected Value | Previous (incorrect) Value |
|-----------|----------------|---------------------------|
| Depositor APY range | **8 % – 12 %** | 8 % – 25 % (overstated) |
| Base yield assumption (projections) | **10 %** (midpoint) | 10 % (unchanged) |
| Protocol management spread | 0 % – 2 % | not stated |

### Rationale

The 8 %–12 % range reflects:

1. **Lower bound (8 %)**: Conservative yield expectation during periods of tight
   liquidity or market stress in African money-market instruments.
2. **Midpoint (10 %)**: The base assumption used in all revenue projection scenarios.
   This is the figure that produces the revenue model examples in §19.2.
3. **Upper bound (12 %)**: Achievable during favourable market conditions, consistent
   with historical yields on short-duration African sovereign paper.

A 25 % upper bound is not achievable on the conservative money-market and short-term
government-securities portfolio used by ACBU without taking on credit or duration risk
that is inconsistent with the reserve management policy.

---

## Revenue Projections (Aligned with 10 % Base Assumption)

| AUM | APY Assumption | Gross Annual Yield | Mgmt Spread (est.) | Net to Depositors |
|-----|---------------|--------------------|--------------------|------------------|
| $10 M | 10 % | ~$1.0 M | 0–2 % (up to $200 K) | ~$800 K – $1.0 M |
| $20 M | 10 % | ~$2.0 M | 0–2 % (up to $400 K) | ~$1.6 M – $2.0 M |
| $50 M | 10 % | ~$5.0 M | 0–2 % (up to $1.0 M) | ~$4.0 M – $5.0 M |

> **Previous revenue example ($3–5 M on $50 M)** implied an effective APY of 6–10 %,
> which is below the stated 8 % lower bound at the $3 M end. The corrected
> projection at 10 % produces ~$5 M gross on $50 M AUM, which is both internally
> consistent and within the 8–12 % depositor range after the management spread.

---

## Savings Vault Configuration Reference

```typescript
// Savings vault yield parameters (governance-adjustable from Phase 3)
const SAVINGS_APY_TARGET_PERCENT = 10;     // Base projection assumption
const SAVINGS_APY_MIN_PERCENT    = 8;      // Floor — below this, yield is suspended
const SAVINGS_APY_MAX_PERCENT    = 12;     // Ceiling — upper bound of advertised range
const MGMT_SPREAD_MIN_PERCENT    = 0;      // Protocol minimum management spread
const MGMT_SPREAD_MAX_PERCENT    = 2;      // Protocol maximum management spread
```

---

## User-Facing Disclosure

The correct user-facing disclosure for Savings Vault APY is:

> "The Savings Vault targets an annual yield of **8 %–12 % APY**, derived from
> deploying idle reserves into African money-market instruments and short-term
> government securities. The target yield is not guaranteed; actual returns depend on
> market conditions and may be lower. A management spread of up to 2 % is retained by
> the protocol."

---

## What Changed

| Location | Before | After |
|----------|--------|-------|
| Platform spec §12.3 | "8–25 % APY … ~$3–5 M annually on $50 M" | "8–12 % APY … ~$5 M annually on $50 M at 10 % base" |
| Platform spec §19.2 | Flat 10 % APY; $0.5 M / $2 M / $5 M | Aligned: flat 10 % APY; $1 M / $2 M / $5 M (corrected $10 M row) |

---

## Related

- `docs/docs.md §12.3` — float interest in the fee schedule
- `docs/docs.md §19.2` — float interest revenue projections
- `src/config/savings.ts` — runtime savings vault configuration
- `src/jobs/yieldAccrualJob.ts` — daily yield accrual job
