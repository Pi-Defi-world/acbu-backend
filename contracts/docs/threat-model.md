# ACBU Smart Contract — Threat Model & Authorization Invocation Tree

**Issue:** C-038  
**Severity:** High  
**Area:** contracts/security  
**Status:** Addressed in this document

---

## 1. Overview

This document describes the authorization invocation tree for all cross-contract calls in the ACBU protocol, the trust assumptions each call relies on, and the mitigations in place. It is the acceptance artifact for issue C-038.

---

## 2. Contract Topology

```
                        ┌─────────────────────────────────────────┐
                        │           ADMIN (Multisig / EOA)        │
                        │  - Initializes all contracts            │
                        │  - Sets fees, rates, pause states       │
                        │  - Manages validators (oracle)          │
                        │  - Is the SAC issuer / minter authority │
                        └──────────────┬──────────────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
              ▼                        ▼                        ▼
       ┌────────────┐          ┌──────────────┐        ┌──────────────────┐
       │   ORACLE   │          │   RESERVE    │        │    MINTING       │
       │ (rate feed)│          │   TRACKER    │        │    CONTRACT      │
       └─────┬──────┘          └──────┬───────┘        └────────┬─────────┘
             │                        │                          │
             │ get_acbu_usd_rate_*    │ is_reserve_sufficient   │ StellarAssetClient::mint
             │ get_rate_with_timestamp│                          │ token::Client::transfer
             │ get_currencies         │                          │
             │ get_basket_weight      │                          │
             │ get_s_token_address    │                          │
             └────────────────────────┘                          │
                                                                  ▼
                                                         ┌──────────────────┐
                                                         │   ACBU SAC       │
                                                         │ (Stellar Asset   │
                                                         │  Contract)       │
                                                         └──────────────────┘
              ┌────────────────────────────────────────────────────────────┐
              │                    BURNING CONTRACT                        │
              │  token::Client::burn(user, amount)                         │
              │  token::Client::transfer_from(burning_contract, vault, …)  │
              └────────────────────────────────────────────────────────────┘
```

---

## 3. Cross-Contract Call Inventory

### 3.1 Minting Contract → Oracle

| Call | Method | Auth requirement | Staleness guard |
|------|--------|-----------------|-----------------|
| Get ACBU/USD rate | `get_acbu_usd_rate_with_timestamp` | None (read-only) | `check_oracle_freshness` — panics if `now > oracle_ts + UPDATE_INTERVAL_SECONDS` |
| Get currency rate | `get_rate_with_timestamp` | None (read-only) | Same freshness check |
| Get currencies list | `get_currencies` | None (read-only) | — |
| Get basket weight | `get_basket_weight` | None (read-only) | — |
| Get S-token address | `get_s_token_address` | None (read-only) | — |

**Trust assumption:** The oracle contract address stored at initialization is correct and has not been replaced. Admin is responsible for setting the correct oracle address.

**Threat:** A compromised oracle could return manipulated rates, causing ACBU to be minted at an incorrect price.  
**Mitigation:** Freshness checks on every rate read; oracle uses multi-validator median aggregation with outlier detection.

---

### 3.2 Minting Contract → Reserve Tracker

| Call | Method | Auth requirement | Guard |
|------|--------|-----------------|-------|
| Reserve sufficiency check | `is_reserve_sufficient(projected_supply)` | None (read-only) | Panics if `!reserve_ok` |

**Trust assumption:** The reserve tracker address stored at initialization is correct. The reserve tracker itself calls the oracle for the ACBU/USD rate.

**Threat:** A malicious reserve tracker could always return `true`, bypassing the collateral check.  
**Mitigation:** Reserve tracker address is set at initialization by admin and cannot be changed without an upgrade.

---

### 3.3 Minting Contract → ACBU Stellar Asset Contract (SAC)

| Call | Method | Auth requirement |
|------|--------|-----------------|
| Mint ACBU to recipient | `StellarAssetClient::mint(&recipient, &amount)` | **This contract must be the SAC issuer or an authorized minter.** The Soroban auth tree is: `admin/issuer → minting_contract`. |
| Mint fee ACBU to treasury | `StellarAssetClient::mint(&treasury, &fee)` | Same as above. |

**Trust assumption:** The minting contract address has been granted minter authority on the ACBU SAC by the issuer account. This is a deployment-time configuration step.

**Threat:** If the wrong contract is granted minter authority, unauthorized ACBU can be minted.  
**Mitigation:** Minter authority is granted by the issuer (admin multisig) and should be audited at deployment. Only one contract should hold minter authority at any time.

**Auth tree for `mint_from_usdc`:**
```
Transaction invoker (user)
  └─ user.require_auth()                    [minting contract checks]
       └─ StellarAssetClient::mint(...)     [SAC checks: invoker == minter]
```

**Auth tree for `mint_from_basket`:**
```
Transaction invoker (user)
  └─ user.require_auth()                    [minting contract checks]
       ├─ token::Client::transfer(user → vault, stoken_i)
       │    └─ [SAC checks: user signed the tx; minting_contract in auth tree]
       └─ StellarAssetClient::mint(recipient, net_mint)
            └─ [SAC checks: invoker == minter]
```

**Auth tree for `mint_from_single`:**
```
Transaction invoker (user)
  └─ user.require_auth()                    [minting contract checks]
       ├─ token::Client::transfer(user → vault, s_token_amount)
       └─ StellarAssetClient::mint(recipient, acbu_amount)
```

**Auth tree for `mint_from_fiat` / `mint_from_demo_fiat`:**
```
Transaction invoker (operator)
  └─ operator.require_auth()                [minting contract checks]
       └─ StellarAssetClient::mint(recipient, acbu_amount)
            └─ [SAC checks: invoker == minter]
```

---

### 3.4 Minting Contract → S-Token Contracts

| Call | Method | Auth requirement |
|------|--------|-----------------|
| Transfer S-token from user to vault | `token::Client::transfer(&user, &vault, &amount)` | `user.require_auth()` must be called before this; Soroban propagates the auth context. |

**Trust assumption:** The S-token addresses returned by the oracle are legitimate Stellar Asset Contracts. A compromised oracle could return a malicious token address.  
**Mitigation:** Oracle validator multi-sig and freshness checks reduce this risk. S-token addresses should be verified at deployment.

---

### 3.5 Burning Contract → ACBU Token

| Call | Method | Auth requirement |
|------|--------|-----------------|
| Burn ACBU from user | `token::Client::burn(&user, &acbu_amount)` | `user.require_auth()` must be called before this. Soroban propagates the auth context so the token contract sees the user's authorization. |

**Trust assumption:** The ACBU token address stored at initialization is the correct SAC. The `burn` function on the SAC requires the caller to be authorized by the token holder (`user`).

**Auth tree for `redeem_single` / `redeem_basket`:**
```
Transaction invoker (user)
  └─ user.require_auth()                    [burning contract checks]
       └─ token::Client::burn(user, amount) [SAC checks: user authorized burning_contract]
```

---

### 3.6 Burning Contract → S-Token Contracts (via Vault)

| Call | Method | Auth requirement |
|------|--------|-----------------|
| Transfer S-token from vault to recipient | `token::Client::transfer_from(&spender, &vault, &recipient, &amount)` | **The vault must have pre-approved the burning contract as a spender** via `approve(burning_contract, stoken, allowance)`. |

**Trust assumption (explicit):** The vault account has called `approve(burning_contract_address, stoken_address, sufficient_allowance)` for every S-token in the basket. This is a deployment-time and ongoing operational requirement.

**Threat:** If the vault approval is absent or insufficient, `transfer_from` will revert with an auth error. This is the correct safe-fail behaviour — no funds are moved.  
**Threat:** If the vault approval is set to an unlimited allowance and the burning contract is compromised, the vault's S-token holdings could be drained.  
**Mitigation:** Set vault approvals to a bounded allowance (e.g., rolling 24-hour limit) rather than `i128::MAX`. Rotate approvals regularly.

**Auth tree for `redeem_single`:**
```
Transaction invoker (user)
  └─ user.require_auth()                         [burning contract checks]
       ├─ token::Client::burn(user, acbu_amount)  [SAC: user authorized]
       └─ token::Client::transfer_from(
              spender=burning_contract,
              from=vault,
              to=recipient,
              amount=stoken_out
          )                                       [SAC: vault pre-approved burning_contract]
```

---

### 3.7 Reserve Tracker → Oracle

| Call | Method | Auth requirement |
|------|--------|-----------------|
| Get ACBU/USD rate | `get_acbu_usd_rate` | None (read-only) |

**Note:** `is_reserve_sufficient` is called by minting/burning contracts. The reserve tracker in turn calls the oracle. This creates a two-hop cross-contract call chain:

```
minting_contract
  └─ reserve_tracker::is_reserve_sufficient(projected_supply)
       └─ oracle::get_acbu_usd_rate()
```

No auth is required on the read-only oracle call. The chain is safe as long as both addresses are correctly configured.

---

### 3.8 Reserve Tracker → ACBU Token

| Call | Method | Auth requirement |
|------|--------|-----------------|
| Get total supply | `env.invoke_contract(acbu_token, "get_total_supply", [])` | None (read-only) |

**Note:** `get_total_supply` is a read-only call. No auth required.

---

## 4. Wrong-Invoker Scenarios & Mitigations

### 4.1 Unauthorized Mint

**Scenario:** An attacker calls `mint_from_usdc` with `user = attacker` but without signing the transaction as `user`.  
**Mitigation:** `user.require_auth()` is called at the top of every mint entrypoint. Soroban will revert if the transaction does not include a valid signature for `user`.

### 4.2 Unauthorized Burn

**Scenario:** An attacker calls `redeem_single(user=victim, ...)` to burn the victim's ACBU.  
**Mitigation:** `user.require_auth()` is called at the top of every burn entrypoint. The victim's signature is required.

### 4.3 Operator Impersonation in `mint_from_fiat`

**Scenario:** An attacker passes `operator = legitimate_operator_address` but does not hold the operator key.  
**Mitigation:** The contract checks `operator == expected_operator` (stored at init) AND calls `operator.require_auth()`. Both checks must pass.

### 4.4 Stale Oracle Rate Exploitation

**Scenario:** An attacker waits for oracle rates to go stale, then calls a mint/burn function to exploit the outdated price.  
**Mitigation:** All rate reads use `*_with_timestamp` variants and `check_oracle_freshness` enforces a maximum staleness of `UPDATE_INTERVAL_SECONDS` (6 hours). This applies to all mint paths including `mint_from_fiat` (fixed in C-038).

### 4.5 Vault Allowance Drain

**Scenario:** A compromised burning contract drains the vault's S-token holdings via `transfer_from`.  
**Mitigation:** Vault approvals should be bounded (not `i128::MAX`). The burning contract address should be audited before granting approval. Use a time-limited or amount-limited allowance.

### 4.6 Malicious Oracle Address

**Scenario:** Admin sets a malicious oracle address that returns manipulated rates.  
**Mitigation:** Admin is a multisig. Oracle address changes require a contract upgrade (admin-gated). Monitor oracle address changes on-chain.

### 4.7 Reserve Tracker Always Returns True

**Scenario:** A misconfigured or malicious reserve tracker always returns `true` for `is_reserve_sufficient`.  
**Mitigation:** Reserve tracker address is set at initialization and cannot be changed without an upgrade. The reserve tracker itself calls the oracle for rate data, adding a second layer of validation.

---

## 5. Deployment Checklist (Auth-Related)

Before deploying to mainnet, verify:

- [ ] Minting contract address is granted minter authority on the ACBU SAC by the issuer account
- [ ] Vault account has approved the burning contract as a spender for every S-token in the basket, with a bounded allowance
- [ ] Oracle address stored in minting, burning, and reserve tracker contracts is the correct deployed oracle
- [ ] Reserve tracker address stored in minting and burning contracts is the correct deployed reserve tracker
- [ ] Operator address stored in the minting contract is the correct fintech backend key
- [ ] Admin is a multisig with at least 2-of-3 signers
- [ ] No other contract or account holds minter authority on the ACBU SAC

---

## 6. Changes Made for C-038

1. **`acbu_minting/src/lib.rs` — `mint_from_fiat`**: Replaced non-timestamped oracle calls (`get_acbu_usd_rate`, `get_rate`) with timestamped variants (`get_acbu_usd_rate_with_timestamp`, `get_rate_with_timestamp`) and added `check_oracle_freshness` calls. This closes the stale-rate exploitation window on the fiat mint path.

2. **`acbu_minting/src/lib.rs` — `mint_from_usdc`, `mint_from_basket`**: Added inline comments documenting the `StellarAssetClient::mint` auth tree requirement (this contract must be the SAC minter).

3. **`acbu_minting/src/lib.rs` — `mint_from_basket`**: Added inline comment documenting the `token::Client::transfer` auth propagation requirement for S-token pulls from `user`.

4. **`acbu_burning/src/lib.rs` — `redeem_single`**: Added inline comments documenting the `burn` auth tree and the `transfer_from` vault-approval trust assumption.

5. **`acbu_burning/src/lib.rs` — `redeem_basket`**: Added inline comments documenting the `burn` auth tree and the `transfer_from` vault-approval trust assumption for each basket leg.

6. **`docs/threat-model.md`** (this file): Created comprehensive threat model documenting all cross-contract call auth trees, trust assumptions, wrong-invoker scenarios, and deployment checklist.

---

## 7. References

- [Soroban Authorization Documentation](https://developers.stellar.org/docs/smart-contracts/guides/authorization)
- [Stellar Asset Contract (SAC) Interface](https://developers.stellar.org/docs/smart-contracts/tokens/stellar-asset-contract)
- [Soroban `require_auth` and Auth Trees](https://developers.stellar.org/docs/smart-contracts/guides/authorization#require_auth)
- Issue C-038: Authorization invocation tree for cross-contract calls
