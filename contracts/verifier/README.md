# `verifier` — Host-side wrapper logic

This crate contains the **pure Rust** business rules for KYC tier derivation and
transaction rate-gate checks. It has **no dependency on `soroban-sdk`**, no
WASM compilation target, and no Docker / Stellar localnet requirement.

## Why this exists

The integration tests in `tests/` spin up a full Soroban test environment and
previously required a running Stellar node for end-to-end scenarios. This made
the CI suite slow and fragile.

By extracting the decision-logic — "what tier does this score map to?", "does
this country pass the allow-list?", "does this amount fit within the daily cap?"
— into a standalone crate, we can unit-test it exhaustively and instantly with
plain `cargo test`.

## Running tests

```bash
# From the workspace root — no Docker, no Stellar, just Rust
cargo test -p verifier
```

## Modules

| Symbol                       | Description                                         |
|------------------------------|-----------------------------------------------------|
| `kyc_tier_from_score(score)` | Derive a `KycTier` from a numeric score 0–100       |
| `daily_cap_for_tier(tier)`   | Returns the daily transaction cap for the tier      |
| `is_country_allowed_for_tier1(country)` | Checks country against Tier-1 allow-list |
| `check_rate_gate(…)`         | Full gate check; returns updated window total       |
| `calculate_fee(…)`           | Protocol fee calculation (basis points)             |
| `calculate_amount_after_fee(…)` | Net amount after fee deduction                   |
| `calculate_deviation_bps(…)` | Basis-point deviation between two values            |
| `median_of_slice(…)`         | Median of a `&[i128]` slice (no Soroban Vec needed) |

## KYC tiers

| Tier | Min score | Daily cap         | Country gate              |
|------|-----------|-------------------|---------------------------|
| 0    | –         | 0 (blocked)       | all blocked               |
| 1    | 30        | 100 ACBU          | Tier-1 allow-list only    |
| 2    | 60        | 10 000 ACBU       | none                      |
| 3    | 90        | unlimited         | none                      |

Closes issue **#665** (W2-Z-021).
