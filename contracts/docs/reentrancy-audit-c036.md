# C-036 — Reentrancy Class Issues via Token Callbacks: Audit Notes

**Issue:** C-036  
**Severity:** Medium  
**Area:** contracts/security  
**Auditor:** sanmipaul  

---

## Background: Reentrancy in Soroban

Classic EVM reentrancy (recursive `call` while executing) does not apply to Soroban.
The Soroban host enforces a call stack that prevents a contract from being re-entered
while it is already on the stack.

However, a weaker class of attack is still relevant: **token-callback state confusion**.
If a token contract (ACBU or an S-token) executes logic during `transfer` or
`transfer_from` that reads or writes to the *calling* contract's storage, it may
observe stale state when the calling contract has not yet committed its effects.
The standard defense is **Checks-Effects-Interactions (CEI)** ordering:

1. **Checks** — validate all preconditions
2. **Effects** — commit all state changes to storage
3. **Interactions** — make external calls (token transfers, cross-contract invocations)

All contracts in this repository use the standard Soroban `token::Client` which
reflects the SEP-41 interface. As of the current version, the SEP-41 token interface
does not define a receiver callback hook (no `on_transfer` equivalent). This means
that in practice, the immediate reentrancy risk through the current ACBU and S-token
contracts is low. Nevertheless, CEI ordering is applied throughout as a defensive
measure and to ensure the codebase remains correct if the token interface evolves.

---

## Contract-by-Contract Findings

### 1. `acbu_burning` — `redeem_single` ✅ Fixed (W11-CAR-010 / AC-008)

**Order (before W11-CAR-010 fix):**
```
1. Checks: pause, min amount, oracle freshness, slippage
2. Interactions: acquire_guard                               ← guard acquired
3. Interactions: check_reserves (invoke_contract × 2)       ← reads inside guard ❌
4. Interactions: acbu_client.burn + notify_minting_burn
5. Interactions: token.transfer_from
```

**Problem:** `check_reserves` performs two read-only cross-contract calls
(token total supply + reserve tracker query). Running them inside the guarded
critical section unnecessarily extended the section to include pure-read
cross-contract calls and obscured the CEI boundary.

**Fix applied (W11-CAR-010):** `check_reserves` moved to the Checks phase,
*before* `acquire_guard`. Guard now wraps only the state-mutating Interactions:
`acbu_client.burn`, `notify_minting_burn`, `token.transfer_from`.

**Order after fix:**
```
1. Checks:  pause, min amount, oracle freshness, slippage, reserve ratio ✅
2. Lock:    acquire_guard                                   ← narrowed critical section ✅
3. Interactions: acbu_client.burn + notify_minting_burn
4. Interactions: token.transfer_from
```

---

### 2. `acbu_burning` — `redeem_basket` ✅ Fixed (W11-CAR-010 / AC-008)

**Order:**
```
1. Checks: oracle freshness, reserve check
2. Interactions: acbu_client.burn(&user, &acbu_amount)    ← ACBU irrevocably burned
3. Loop: for each currency:
       invoke_contract (oracle reads)
       token.transfer_from(&spender, &vault, &recipient, &native_i)   ← per-currency payout
```

**Order after fix (W11-CAR-010):**
```
1. Checks:  pause, min amount, oracle freshness, pre-flight slippage, reserve ratio ✅
2. Lock:    acquire_guard                                   ← narrowed critical section ✅
3. Interactions: acbu_client.burn + notify_minting_burn
4. Loop:    per-currency oracle reads + transfer_from
```

**Cross-function reentrancy:** Because both `redeem_single` and `redeem_basket`
use the **same** guard storage key (`symbol_short!("REENTRANT")`), holding the
guard from either path blocks entry into the other. Two new tests in
`tests/reentrancy.rs` verify this:
- `redeem_single_blocked_while_basket_guard_held`
- `redeem_basket_blocked_while_single_guard_held`

A third test (`redeem_basket_releases_guard`) proves the guard is released on
successful completion, mirroring the existing `redeem_single_releases_guard` test.

---

### 3. `acbu_savings_vault` — `deposit` ✅ Fixed (CEI violation)

**Order before fix:**
```
1. Checks: pause, amount > 0, term > 0
2. Interactions: token.transfer(&user, &vault_addr, &net_amount)    ← external call
3. Interactions: token.transfer(&user, &admin, &fee_amount)          ← external call
4. Effects:   env.storage().temporary().set(&key, &lots)              ← state AFTER transfers ❌
```

**Violation:** A token contract with a receiver hook executing during `transfer`
could call back into `deposit` for the same `(user, term_seconds)` key and observe
an empty lot list, allowing a second deposit to overwrite the first lot once the
original call resumes.

**Fix applied:** Deposit lot is written to storage **before** both `transfer` calls.

**Order after fix:**
```
1. Checks
2. Effects:  env.storage().temporary().set(&key, &lots)   ← state first ✅
3. Interactions: token.transfer (vault) + token.transfer (admin fee)
```

---

### 4. `acbu_savings_vault` — `withdraw` ✅ Sound

**Order:**
```
1. Checks
2. Effects: env.storage().temporary().set or .remove     ← state cleared first ✅
3. Interactions: token.transfer (principal) + token.transfer (yield)
```

**Assessment:** Already CEI-correct. State is cleared before any outbound transfers.

---

### 5. `acbu_lending_pool` — `deposit` / `withdraw` ⚠️ No Per-Lender State

**Assessment:** The lending pool does not maintain per-lender balance accounting.
`deposit` emits an event but writes no balance to storage. `withdraw` performs no
balance check — any authorised address can withdraw any amount up to the contract's
total token balance.

This is a functional incompleteness issue (tracked separately), not a reentrancy
issue. CEI cannot be violated where no state transitions exist. Noted here because
the absence of state updates is itself a security gap.

---

### 6. `acbu_escrow` — `create` ✅ Fixed (CEI violation)

**Order before fix:**
```
1. Checks: pause, amount > 0, escrow_id not already in use
2. Interactions: client.transfer(&payer, &contract, &amount)          ← external call ❌
3. Effects:   env.storage().temporary().set(&key, &(payer, payee, amount))
```

**Violation:** A token callback during the inbound `transfer` could call `create`
again with the same `escrow_id`. At that point `env.storage().temporary().has(&key)`
still returns `false`, so the duplicate-key guard passes and the escrow is written
with new parameters. When the original call resumes it overwrites the re-entrant
write, potentially with different `payee` or `amount` values.

**Fix applied:** `env.storage().temporary().set(...)` moved to **before** the
`client.transfer(...)` call.

---

### 7. `acbu_escrow` — `release` ✅ Fixed (CEI violation)

**Order before fix:**
```
1. Checks: pause, payer auth, escrow exists, payer matches
2. Interactions: client.transfer(&contract, &payee, &amount)   ← external call ❌
3. Effects:   env.storage().temporary().remove(&key)
```

**Violation:** A token callback during the outbound `transfer` could call `release`
again. At that point the escrow record is still in storage, so all checks pass and
the payee receives a second payout.

**Fix applied:** `env.storage().temporary().remove(&key)` moved to **before** the
`client.transfer(...)` call.

---

### 8. `acbu_escrow` — `refund` ✅ Fixed (CEI violation)

**Same violation and fix as `release`.** `env.storage().temporary().remove(&key)`
moved to before the `client.transfer(...)` call so the escrow cannot be double-refunded.

---

## Summary Table

| Contract | Function | Status | Finding |
|---|---|---|---|
| `acbu_burning` | `redeem_single` | ✅ Fixed (W11-CAR-010) | `check_reserves` moved before guard; cross-function reentrancy tested |
| `acbu_burning` | `redeem_basket` | ✅ Fixed (W11-CAR-010) | `check_reserves` moved before guard; guard-release test added |
| `acbu_savings_vault` | `deposit` | ✅ Fixed | Storage update moved before token transfers |
| `acbu_savings_vault` | `withdraw` | ✅ Sound | CEI already satisfied |
| `acbu_lending_pool` | `deposit` | ⚠️ Noted | No per-lender state; functional gap, not reentrancy |
| `acbu_lending_pool` | `withdraw` | ⚠️ Noted | No balance check; functional gap, not reentrancy |
| `acbu_escrow` | `create` | ✅ Fixed | State written before inbound transfer |
| `acbu_escrow` | `release` | ✅ Fixed | State cleared before outbound transfer |
| `acbu_escrow` | `refund` | ✅ Fixed | State cleared before outbound transfer |

## Acceptance Checklist

- [x] All token-callback CEI violations identified
- [x] All violations fixed with before/after ordering documented
- [x] Non-reentrancy findings (partial-execution, missing state) noted for separate tracking
- [x] Soroban reentrancy model documented (no `on_transfer` hook in SEP-41; host blocks recursive re-entry)
- [ ] External reviewer sign-off
