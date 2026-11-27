# Resolution Report: W11-CAR-031 / Issue #1384

## Overview

- **ID:** W11-CAR-031
- **GitHub Issue:** [#1384](https://github.com/Pi-Defi-world/acbu-backend/issues/1384)
- **Area:** contracts-escrow
- **Target File:** `contracts/acbu_escrow/src/lib.rs`
- **Status:** RESOLVED

---

## Vulnerability Description & Impact

### Evidence
In `contracts/acbu_escrow/src/lib.rs`, the `create` function for initializing and funding an escrow previously called:
```rust
payer.require_auth();
payee.require_auth();
```
requiring cryptographic authorization from both the `payer` and the `payee`.

### Impact
When creating and funding an escrow payment, requiring payee authorization prevented payers from initiating payments to sellers, contractors, or counterparties unless the payee actively pre-signed the funding transaction. In escrow workflows, creation is a one-sided deposit of funds by the payer into the smart contract; requiring payee co-signature creates an unnecessary dependency and blocks standard escrow funding flows.

---

## Remediation Details

1. **Removed Payee Authorization on Escrow Creation:**
   In `contracts/acbu_escrow/src/lib.rs`, removed `payee.require_auth()` from `create()`. Now only `payer.require_auth()` is enforced when an escrow is created and funded.
   The payee is authorized only on claim/release actions as intended by the protocol.

2. **Documentation & Tests:**
   - Updated documentation on `acbu_escrow::create` to clarify that only payer authorization is required.
   - Added `test_create_requires_only_payer_auth` to `contracts/acbu_escrow/tests/test_full_lifecycle.rs`.

---

## Verification

- Clean diff in `contracts/acbu_escrow/src/lib.rs`.
- Clean addition in `contracts/acbu_escrow/tests/test_full_lifecycle.rs`.
- Zero merge conflicts against `upstream/dev`.
