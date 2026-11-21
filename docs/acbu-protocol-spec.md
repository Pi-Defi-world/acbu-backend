# ACBU Protocol Specification

## §1 Scope

This document defines the authoritative protocol rules for the African Currency Basket Unit
(ACBU) stablecoin. All on-chain and off-chain components MUST conform to these rules.

---

## §2 Glossary

| Term | Definition |
|------|------------|
| **Basket** | The set of African fiat currencies that back one ACBU token |
| **Weight (W_i)** | Policy fraction of total basket value attributable to currency _i_ (0 < W_i < 1, ΣW_i = 1) |
| **FixedAmount_i** | The number of units of currency _i_ that one ACBU always redeems for, computed at each rebalance epoch |
| **Peg Price (P_i)** | The USD price of one unit of currency _i_, sourced from the oracle at rebalance time |
| **Reference Price (R)** | The USD value of one whole ACBU, fixed at launch (default: 1.00 USD) |
| **Rebalance Epoch** | A governance-approved event that sets new weights and recomputes FixedAmount_i |

---

## §3 Basket Invariant

### §3.1 Launch

At launch the basket is initialised by choosing weights **W_i** and a reference price **R**
(typically 1.00 USD).  For every currency _i_ in the basket, the fixed amount is:

```
FixedAmount_i  =  (W_i × R) / P_i
```

Where **P_i** is the oracle USD price of currency _i_ **at launch**.

### §3.2 Redemption Guarantee

During normal operation (between rebalance epochs) **FixedAmount_i is frozen**.
One ACBU always redeems for exactly `FixedAmount_i` units of every basket currency _i_.
Prices and exchange rates fluctuate; the _quantities_ users receive do not.

---

## §4 Minting

A mint request for `n` ACBU requires the user to deposit, for each currency _i_:

```
Deposit_i  =  n × FixedAmount_i
```

The contract verifies each deposit before issuing tokens.

---

## §5 Fixed-Amount Lifecycle

### §5.1 Set at Launch

`FixedAmount_i` values are computed once at contract deployment using §3.1 and stored
on-chain as immutable-until-rebalance values.

### §5.2 Frozen Between Epochs

Between rebalance epochs `FixedAmount_i` MUST NOT change.  Any oracle price movement
during this period is absorbed by the reserve; it does not alter the user's redemption
entitlement.

### §5.3 Updated at Each Rebalance Epoch

When governance approves new weights the `FixedAmount_i` values are recomputed (see §10.3)
and the new values take effect for **all transactions from that point forward**.
Tokens minted under earlier epochs redeem at the new amounts.

---

## §6 Burning / Redemption

A burn request for `n` ACBU releases, for each currency _i_:

```
Release_i  =  n × FixedAmount_i
```

---

## §7 Oracle Requirements

- Prices MUST be fetched from the designated Stellar oracle contract (`CONTRACT_ORACLE`).
- The price snapshot used for a rebalance MUST be within 1 hour of the rebalance transaction.
- Stale prices (> 1 hour) cause the rebalance transaction to revert.

---

## §8 Weight Policy

Current policy weights (governed by the ACBU DAO):

```
W_GDP       = 0.40   (GDP-weighted currencies)
W_Trade     = 0.30   (Trade-flow-weighted currencies)
W_Liquidity = 0.30   (Liquidity-weighted currencies)
```

Within each dimension, individual currency weights sum to that dimension's total weight.

---

## §9 Governance

1. A rebalance proposal is submitted on-chain with new per-currency `W_i` values.
2. The proposal passes a time-lock (minimum 72 hours).
3. Validators vote; quorum ≥ 67% is required.
4. On passage the rebalance executor calls `rebalance(new_weights, oracle_snapshot)`.
5. The contract emits `RebalanceExecuted(epoch, new_weights[], new_fixed_amounts[])`.

---

## §10 Rebalancing

### §10.1 Trigger

Rebalancing is triggered by governance vote when weight drift exceeds 2 pp for any
single currency (see `docs/WEIGHT_DRIFT_AUDIT.md`).

### §10.2 Input Values

The rebalance executor supplies:

| Input | Symbol | Source |
|-------|--------|--------|
| New policy weight for currency _i_ | W_i_new | Governance vote |
| Oracle USD price of currency _i_ | P_i_new | `CONTRACT_ORACLE` (< 1 h old) |
| Basket reference price | R | Fixed at launch (e.g. 1.00 USD) |

### §10.3 Fixed-Amount Recomputation Formula

**This formula is canonical.**  Any implementation (contract, backend service, or off-chain
tooling) MUST use exactly this formula whenever a rebalance epoch is executed:

```
FixedAmount_i_new  =  (W_i_new × R) / P_i_new
```

Where:
- **W_i_new** — the new policy weight approved by governance for currency _i_ (decimal, 0–1)
- **R** — the basket reference price in USD (set at launch; constant across all epochs)
- **P_i_new** — the oracle USD price of currency _i_ sampled within the rebalance transaction

**Worked example** (NGN, post-rebalance epoch):

```
W_NGN_new  = 0.12          (governance-approved weight)
R          = 1.00 USD
P_NGN_new  = 0.000615 USD  (oracle snapshot)

FixedAmount_NGN_new  =  (0.12 × 1.00) / 0.000615
                     ≈  195.12  NGN per ACBU
```

After this epoch, 1 ACBU redeems for exactly **195.12 NGN** (plus the fixed amounts for
all other basket currencies).

### §10.4 On-Chain Enforcement

The smart contract enforces the formula:

1. Receives `(w_i_new[], p_i_new[])` arrays from the governance executor.
2. For each _i_: computes `fixed_amount_i = (w_i_new * R_SCALED) / p_i_new` using
   integer arithmetic with 7 decimal places of precision (scale factor 10^7).
3. Stores new `fixed_amounts[]` on-chain.
4. Emits `RebalanceExecuted` event with old and new values for auditability.

### §10.5 Effective Date

New `FixedAmount_i` values apply to **all transactions submitted after the rebalance
transaction is included in a ledger**.  In-flight transactions (submitted but not yet
finalized) that reference the old epoch are rejected by the contract.

### §10.6 Relationship to §3.2

Section §3.2 states "1 ACBU always equals the same fixed basket amounts."  This refers to
amounts being **stable within an epoch**.  Across epochs, the fixed amounts change
according to §10.3, which is the mechanism by which new governance weights are expressed
as concrete per-token quantities.  The two sections are consistent: no ambiguity exists.

---

## §11 Precision and Rounding

All `FixedAmount_i` values are stored and transmitted with **7 decimal places**.
Division in §10.3 is performed in full-precision arithmetic before truncation to 7 d.p.
Rounding is **floor** (truncate towards zero) to avoid issuing more tokens than backed.

---

## §12 Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-10-18 | Added §10.3 canonical recomputation formula; reconciled §3.2 / §5.1 / §5.3 (fixes W10-DOC-012) | Audit remediation |
