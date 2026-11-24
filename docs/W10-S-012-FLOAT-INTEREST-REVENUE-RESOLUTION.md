# W10-S-012: Resolution of Float-Interest Revenue and Segregated Partner Reserves

**Issue ID:** W10-S-012  
**GitHub Issue:** #1141  
**Area:** Architecture / Financial Engineering / Custodial Design  
**Severity:** High  
**Status:** Resolved

---

## 1. Executive Summary

During the Wave 10 security and economic audit of the ACBU protocol, an inconsistency was identified between the revenue model and the custodial reserve architecture:

- **Evidence:** `docs.md §12.3` projected **$3–5M annually** in float-interest revenue (assumed 8–25% or 6–10% APY on a $50M reserve float), while `§4.3` specifies that operational fiat reserves backing ACBU are **segregated in partner-held accounts** across multiple African banking jurisdictions.
- **Impact:** In standard commercial banking, escrow, and fintech custodial arrangements, interest on accounts held by or in the name of a licensed partner accrues legally to the **partner/custodian**, not to the protocol, unless explicitly assigned through a binding legal entitlement. Relying on uncontracted float interest artificially overstates protocol revenue by $3–5M annually and severely distorts the transaction volume required for operational breakeven.
- **Audit Recommendation:** Confirm interest entitlement contractually through partner agreements or remove float interest from the baseline revenue model and re-run all financial and breakeven projections.

This document formally details the rectification of this issue:

1. Adopting a **Conservative Baseline Model (Production Default)** where float interest on partner-held segregated reserves is **zeroed out ($0.00)** in core budget and breakeven projections.
2. Establishing the **Partner Reserve & Interest Agreement (PRIA)** framework, defining the strict legal, operational, and technical criteria under which partner float interest may be recognized as conditional revenue.
3. Re-running the breakeven financial projections, correcting the required annualized transaction volume from the flawed ~$73.7M target (which assumed $3.5M uncontracted float interest) to an audited **~$442.1M target** (assuming a conservative 95 bps blended take rate).
4. Implementing programmatic governance via `FloatRevenueService` and validating all rules through automated test suites.

---

## 2. Root Cause Analysis: §12.3 vs §4.3 Contradiction

### 2.1 The Architectural Conflict

The ACBU token is backed by a diversified basket of African fiat currencies (NGN, KES, ZAR, GHS, RWF, EGP, etc.). To support localized on/off-ramps, fiat deposits, and real-time redemptions without cross-border banking friction, the protocol relies on licensed fintech partners and regional depository banks in each country:

```
[User Fiat Deposit] ──> [Licensed Regional Partner] ──> [Partner-Held Segregated Bank Account]
                                                                  │
                                                        Accrues Bank Interest
                                                                  │
                                                                  ▼
                                                      Partner / Depository Bank
                                                   (NOT ACBU without agreement)
```

In `§4.3`, the protocol correctly mandates reserve segregation: _partner-held accounts keep user collateral legally segregated from the partner's operating funds_.

However, `§12.3` incorrectly assumed that the deposit interest generated on these segregated partner accounts would automatically flow into ACBU's treasury:

- Assumed Reserve Float: **$50,000,000 USD equivalent**
- Assumed APY: **6.0% – 10.0%**
- Projected Annual Float Revenue: **$3,000,000 – $5,000,000 USD**

### 2.2 Legal & Custodial Realities

1. **Title and Account Holder Status:** Depository accounts holding local fiat reserves are registered in the corporate name of the licensed domestic fintech partner or partner bank, not the decentralized ACBU DAO.
2. **Statutory Custody Rules:** Under central bank regulations across jurisdictions (e.g., Central Bank of Nigeria, Central Bank of Kenya, South African Reserve Bank), yield earned on client funds in omnibus or escrow accounts either:
   - Accrues to the licensed financial institution as custodial compensation, or
   - Must be retained in a statutory reserve buffer, or
   - Requires explicit contractual assignment and tax withholding to be remitted to a foreign protocol entity.
3. **Flawed Entitlement Assumption:** Because default partner API onboarding agreements did not include an explicit pass-through clause for overnight float interest, the protocol had **zero enforceable legal claim** to this revenue stream.

---

## 3. Financial Impact & Breakeven Rectification

### 3.1 The Flawed Breakeven Math

The protocol's annual operating expenditure (OpEx) for core infrastructure, node hosting, security audits, compliance reporting, legal retainers, and core team engineering is budgeted at **$4,200,000 USD**.

Under the flawed specification:
$$\text{OpEx} = \$4,200,000$$
$$\text{Assumed Float Revenue} = \$3,500,000$$
$$\text{Net Revenue Required from Volume} = \$4,200,000 - \$3,500,000 = \$700,000$$

At a blended protocol take-rate of **95 bps (0.95%)** (comprising mint/burn fees, FX spreads, and route fees):
$$\text{Flawed Volume Target} = \frac{\$700,000}{0.0095} \approx \$73,684,210 \text{ USD} \approx \mathbf{\$73.7M}$$

Subtracting an uncontracted $3.5M float interest reduced the net revenue required from transaction volume from $4.2M to only $700,000, artificially suppressing the breakeven volume target.

### 3.2 The Audited Conservative Baseline Model

Under the conservative baseline adopted herein, uncontracted partner float interest is set strictly to **$0.00**:

$$\text{OpEx} = \$4,200,000$$
$$\text{Recognized Partner Float Interest} = \$0.00$$
$$\text{Net Revenue Required from Volume} = \$4,200,000$$

$$\text{Audited Breakeven Volume} = \frac{\$4,200,000}{0.0095} = \$442,105,263 \text{ USD} \approx \mathbf{\$442.1M}$$

### 3.3 Illustrative Projections Across Volume Tiers

Rows with a non-zero `Protocol Savings Yield` are illustrative scenarios, not the conservative baseline. The conservative baseline excludes uncontracted partner float interest. The `$442.1M` breakeven row also assumes `$0` protocol savings yield.

| Annualized Volume  | Fee Take-Rate (95 bps) | Protocol Savings Yield (Scenario Assumption)* | Partner Float Interest (Baseline) | Total Protocol Revenue | Annual OpEx    | Net Operating Surplus / OpEx |
| ------------------ | ---------------------- | --------------------------------------------- | --------------------------------- | ---------------------- | -------------- | ---------------------------- |
| **$50,000,000**    | $475,000               | $0                                            | **$0**                            | $475,000               | $4,200,000     | -$3,725,000 (Deficit)        |
| **$100,000,000**   | $950,000               | $150,000                                      | **$0**                            | $1,100,000             | $4,200,000     | -$3,100,000 (Deficit)        |
| **$250,000,000**   | $2,375,000             | $350,000                                      | **$0**                            | $2,725,000             | $4,200,000     | -$1,475,000 (Deficit)        |
| **$442,105,263**   | **$4,200,000**         | $0                                            | **$0**                            | **$4,200,000**         | **$4,200,000** | **$0 (Breakeven Point)**     |
| **$500,000,000**   | $4,750,000             | $500,000                                      | **$0**                            | $5,250,000             | $4,200,000     | +$1,050,000 (+25.0%)         |
| **$1,000,000,000** | $9,500,000             | $1,000,000                                    | **$0**                            | $10,500,000            | $4,200,000     | +$6,300,000 (+150.0%)        |

_\*Note: Protocol Savings Yield is generated strictly by protocol-deployed capital in the `investment_savings` segment governed by `allocationService.ts`, entirely separate from operational partner float. Scenario values ($150k, $350k, $500k, $1M) reflect illustrative deployments of protocol treasury capital at a modeled 5.0% APY across expanding protocol balance sheets ($3M, $7M, $10M, $20M deployed capital). These values are not included in the $442.1M conservative-baseline breakeven calculation._

---

## 4. Contractual Entitlement Framework: The PRIA Standard

Where the protocol actively negotiates interest sharing with Tier-1 banking and fintech partners, float interest may be recognized **only** if the partnership satisfies the **Partner Reserve & Interest Agreement (PRIA)** framework:

### 4.1 PRIA Mandatory Requirements

1. **Explicit Legal Assignment:** The agreement must feature a binding assignment clause transferring beneficial interest in account yields from the partner omnibus account to the ACBU Treasury.
2. **Automated Sweep or Settlement:** Interest must be swept or settled on a weekly or monthly basis directly into an on-chain or audited treasury account.
3. **Regulatory Capital Haircut:** Partners are permitted to retain **20% – 30%** of gross yield (`partnerRetentionBps = 2000..3000`) to cover domestic deposit insurance, account administration, and local regulatory capital costs. The protocol receives the remaining **70% – 80%** (`protocolShareBps = 7000..8000`).
4. **No Re-Hypothecation of Operational Liquidity:** Segregated accounts used for real-time mint/burn settlement (`transactions` segment) must never be locked in illiquid or high-risk instruments. Only overnight call deposits or short-term treasury bills backing the partner account qualify.

### 4.2 Conditional Upside Model (With Ratified PRIA)

If the protocol successfully ratifies PRIA agreements across 50% of its projected $50M float at an average gross yield of 9.0% with a 75% protocol share:

- Gross Float Yield on Entitled Reserves ($25M @ 9.0%): **$2,250,000 USD**
- Protocol Share (75%): **$1,687,500 USD**
- Partner Retention (25%): **$562,500 USD**

In this upside scenario, the required transaction volume to achieve breakeven drops to:
$$\text{Net Required} = \$4,200,000 - \$1,687,500 = \$2,512,500$$
$$\text{Upside Breakeven Volume} = \frac{\$2,512,500}{0.0095} \approx \mathbf{\$264.5M}$$

However, this conditional upside is treated as **non-baseline upside** and is never presumed in solvency planning.

---

## 5. Technical Implementation & Segregation

To enforce these rules across the codebase:

1. **`src/services/treasury/floatRevenueService.ts`**:
   - `calculatePartnerFloatYield`: Enforces `hasContractualEntitlement === true` before any float interest is recognized. Uncontracted partner reserves yield strictly `$0.00` to the protocol.
   - `calculateRevenueProjection`: Evaluates fee revenue, savings yield, and conditionally entitled float yield.
   - `calculateBreakevenVolume`: Dynamically recomputes breakeven volume requirements based on confirmed vs zeroed float interest.

2. **Integration with Reserve Segments**:
   - The protocol enforces strict boundary separation between:
     - **`transactions` Segment:** Operational float in partner segregated accounts. By default, earns $0 protocol yield.
     - **`investment_savings` Segment:** Governed by `src/services/investment/allocationService.ts`, deployed directly by protocol governance into vetted on-chain yield strategies.

---

## 6. Verification and Testing

The implementation is verified via `tests/floatRevenueService.test.ts`:

- **Unentitled Partner Isolation:** Verified that an unentitled partner holding $15M at 10% APY yields $0 to the protocol and 100% ($1.5M) to the partner.
- **PRIA Revenue Sharing:** Verified that an entitled partner holding $20M at 9% APY with 80/20 split awards $1.44M to the protocol and $360k to the partner.
- **Mixed Portfolio Aggregation:** Verified correct multi-currency aggregation across entitled and uncontracted accounts.
- **Breakeven Rectification:** Confirmed the mathematical shift from the flawed ~$73.7M breakeven to the audited $442.1M baseline.

---

## 7. Conclusion

By separating operational partner-held segregated reserves from protocol yield expectations and aligning financial models with banking realities:

- The protocol eliminates a critical $3–5M structural deficit in its revenue projections.
- Solvency targets and fundraising milestones now accurately reflect the real **$442.1M** breakeven threshold.
- A formalized framework (PRIA) provides a compliant path to capture float interest where contractually secured.
