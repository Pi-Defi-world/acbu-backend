# ACBU Governance Model

> **Audit note W10-DOC-021:** Previous platform copy erroneously stated that protocol
> parameters are "governed by quarterly DAO multisig vote". That claim is incorrect
> for the current launch phase. This document is the authoritative governance
> reference. All user-facing copy must align with the phased model described here.

---

## Current Governance Status

**ACBU is currently in Phase 1 — Founding Board governance.**

On-chain DAO governance is planned for Year 3 and is **not yet active**. Users and
integrators should not assume DAO-level decentralisation until the Phase 3 transition
is formally announced and ratified on-chain.

---

## Phased Governance Model

ACBU governance evolves in three phases to balance immediate operational needs with
long-term decentralisation.

| Phase | Period | Governing Body | Decision Mechanism |
|-------|--------|----------------|--------------------|
| Phase 1 – Founding Board | Launch → Year 2 | 7-member Founding Board | Simple majority (4 of 7) |
| Phase 2 – Hybrid | Year 2 → Year 3 | Founding Board + elected community delegates | On-chain advisory votes; binding ratification by Board |
| Phase 3 – DAO | Year 3+ | Token-weighted DAO | On-chain governance contract; Founding Board holds veto only for security emergencies |

---

## Phase 1: Founding Board (Current)

The Founding Board comprises 7 individuals elected at the genesis ceremony.

### Decision thresholds

| Decision Type | Threshold |
|---------------|-----------|
| Routine parameter changes (fees, limits) | Simple majority — 4 of 7 |
| Basket composition changes | Supermajority — 5 of 7 |
| Protocol upgrades affecting tokenomics | Supermajority — 5 of 7 |
| Emergency security actions | 2 of 7 (time-locked 48 h) |

### Board seat rotation

Board seats rotate on 2-year terms. Vacancies are filled by community nomination
within 30 days.

### Transparency

All Founding Board decisions are published in the public governance log at
`https://acbu.io/governance/log` within 7 days of ratification.

---

## Phase 2: Hybrid Governance (Year 2 – Year 3)

Community delegates are elected proportionally by staked ACBU holders. Advisory
votes are non-binding but publicly recorded on-chain. The Founding Board must provide
a written rationale when overriding an advisory vote result.

---

## Phase 3: DAO (Year 3+)

From Year 3, subject to regulatory approval and community readiness review, governance
transitions to a token-weighted on-chain DAO.

### DAO proposal process

1. Any holder of ≥ 10,000 ACBU may submit a governance proposal.
2. Proposals enter a 3-day public discussion period.
3. A 7-day on-chain vote follows.
4. Quorum: minimum 1 % of circulating supply must participate.
5. Passing threshold: simple majority of votes cast (some categories require 60 %).

### Founding Board veto (Phase 3)

The Founding Board retains a time-locked emergency veto (48-hour window) to block
DAO proposals that endanger user funds or violate regulatory obligations. All vetoes
are published on-chain immediately with a written justification.

---

## Parameters Adjustable by Governance

The following parameters are governance-adjustable **from Phase 3 (Year 3+)** unless
otherwise noted. Until Phase 3, changes require Founding Board majority approval.

| Parameter | Current Default | Governance Phase Unlock |
|-----------|----------------|------------------------|
| `feeAcbu` (KYC application fee) | 1 ACBU | Phase 3 |
| Mint fee BPS | 30 / 50 / 100 | Phase 3 |
| Basket currency weights | See oracle committee | Phase 2 (advisory) / Phase 3 (binding) |
| KYC tier transaction limits | See `docs/KYC_LAYER.md` | Phase 3 |
| Travel Rule thresholds | Regulatory — not adjustable | N/A |
| Validator `minValidatorsPerApplication` | 2 | Phase 3 |
| Savings Vault APY target range | 8 %–12 % | Phase 3 |

---

## Correction Notice

**Superseded copy:** Any platform documentation, marketing material, or API response
that refers to "quarterly DAO multisig vote" as the current governance mechanism is
incorrect. The correct statement for the current phase is:

> "Protocol parameters are governed by the ACBU Founding Board under a simple-majority
> rule. On-chain DAO governance is planned for Year 3 and is not yet active."

---

## Related

- `docs/docs.md §14` — governance overview in the platform specification
- `docs/docs.md §24.4` — current governance status note
- `https://acbu.io/governance` — public governance dashboard
