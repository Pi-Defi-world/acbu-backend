# KYC Layer Specification

## Overview

ACBU implements a tiered KYC model. All users must complete at least Tier 1 before
transacting. Higher tiers unlock increased transaction limits and cross-border
functionality. A distributed network of accredited validators reviews applications and
earns ACBU token rewards for correct decisions.

---

## KYC Tiers and Transaction Limits

| Tier | Name | Required Documents | Daily Send Limit | Monthly Send Limit | Cumulative Balance Limit |
|------|------|--------------------|------------------|--------------------|--------------------------|
| 0 | Unverified | None | $0 (no transactions) | $0 | $0 |
| 1 | Basic | Government-issued photo ID + selfie | $500 | $2,000 | $5,000 |
| 2 | Standard | Tier 1 docs + proof of address (≤ 3 months old) | $5,000 | $20,000 | $50,000 |
| 3 | Enhanced | Tier 2 docs + source-of-funds declaration | $50,000 | $200,000 | Unlimited |

> Limits are expressed in USD-equivalent value. Local-currency amounts are converted at
> the prevailing oracle mid-rate at the time of transaction.

---

## Travel Rule Compliance

ACBU applies FATF Travel Rule obligations based on the **total USD-equivalent value** of
a single transfer originating from or destined for a regulated VASP counterparty.

| Threshold | Obligation |
|-----------|-----------|
| < $1,000 | No Travel Rule data required |
| ≥ $1,000 (FATF standard) | Originator and beneficiary information must be transmitted to the receiving VASP before or simultaneously with the transfer |
| ≥ $3,000 (US FinCEN rule) | Full originator + beneficiary data transmitted; records retained ≥ 5 years |
| ≥ $10,000 | Automatic Suspicious Activity Report (SAR) consideration trigger |

> Thresholds are checked at the **settlement layer** after FX conversion.
> Transfers between ACBU-internal wallets are exempt from inter-VASP data exchange but
> are subject to internal AML screening.

---

## KYC Fee

A one-time application fee of **1 ACBU** is charged per KYC application submission.
The fee is deducted from the user's wallet balance before the application enters the
review queue. This fee:

- Is non-refundable regardless of the review outcome (approved or rejected).
- Is recorded in `KycApplication.feePaidAcbu` and cross-referenced via
  `KycApplication.feeMintTransactionId`.
- Compensates the validator pool: validator rewards are drawn from the accumulated
  fee pool, not from protocol reserves.

> **Fee configuration constant:** `feeAcbu = 1` (default; governance-adjustable).
> See `docs/fees.md §KYC Application Fee` for the user-facing fee table entry.

---

## Validator Network and Cold-Start Resolution

### Validator Requirements

A `KycValidator` must satisfy **all** of the following before being assigned
applications:

| Requirement | Value | Rationale |
|-------------|-------|-----------|
| `status` | `active` | Inactive / suspended validators are excluded |
| `accuracyScore` | ≥ 0.70 (70 %) | Ensures only experienced validators are assigned |
| `completedCount` | ≥ 0 | No minimum completions for initial bootstrap |
| Country match | `countryCode` matches application | Jurisdictional expertise |

`minValidatorsPerApplication = 2` — at least two independent validators must record a
decision before consensus is evaluated.

### Cold-Start Bootstrap Problem and Resolution

The validator network faces a cold-start loop: newly registered validators have
`completedCount = 0` and have not yet demonstrated accuracy, yet they need to process
applications in order to build a track record.

ACBU resolves this with a **graduated onboarding path**:

1. **Trainee mode** (0 – 9 completed reviews)  
   New validators are assigned to a parallel shadow queue. Their decisions are recorded
   but do **not** count toward the binding consensus. Each trainee decision is scored
   against a set of pre-labelled golden-set applications maintained by the Founding
   Board. Trainees whose shadow accuracy is ≥ 0.80 over their first 10 reviews are
   automatically promoted to `active` status.

2. **Founding-Board seed validators**  
   At genesis, at least **5** Founding Board-approved validators per supported country
   are seeded with `status = active` and `accuracyScore = 1.0` to ensure the network
   is operational from day 0 with no dependency on external applicants.

3. **Grace-period single-validator rule**  
   During the bootstrapping period (defined as fewer than 3 active validators for a
   given country), the consensus threshold is relaxed to `minValidatorsPerApplication
   = 1`, allowing single-validator approvals. A `BOOTSTRAP_CONSENSUS` flag is recorded
   on the application for audit purposes.

4. **Incentivised validator recruitment**  
   The protocol reserves 0.1 ACBU from each application fee as a recruitment subsidy
   paid to the validator who referred a new validator that subsequently becomes active.

---

## Consensus and Application Lifecycle

```
User submits application (fee deducted)
        │
        ▼
   Status: pending
        │
        ▼ (≥ 1 active validator picks up)
   Status: under_review
        │
        ├─ machineConfidence ≥ 0.95 ──► auto-approve path (no human needed)
        │
        ▼ (minValidatorsPerApplication decisions collected)
   Consensus evaluated
        │
        ├─ majority approve ──► Status: approved, kycStatus → tier promoted
        └─ majority reject  ──► Status: rejected, rejectionReason populated
```

---

## Configuration Reference

| Parameter | Default | Governance Adjustable |
|-----------|---------|----------------------|
| `feeAcbu` | 1 | Yes (DAO vote, Year 3+) |
| `minValidatorsPerApplication` | 2 | Yes |
| `bootstrapMinValidators` | 1 | No (hard-coded safety floor) |
| `traineeShadowCount` | 10 | Yes |
| `traineePromotionThreshold` | 0.80 | Yes |
| `travelRuleThresholdFatf` | $1,000 | Regulatory (not adjustable) |
| `travelRuleThresholdFinCen` | $3,000 | Regulatory (not adjustable) |

---

## Related

- `docs/fees.md` — user-facing fee schedule (including KYC application fee)
- `docs/architecture/domains/kyc.md` — database ERD and entity notes
- `src/controllers/kycController.ts` — document upload / scan webhook
- `src/services/kyc/kycValidatorRewardService.ts` — reward payout logic
