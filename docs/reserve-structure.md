# Reserve Structure & Residual-Risk Model

> **Document scope:** This document describes how ACBU reserves are held, the layered buffer
> architecture, and the residual-risk exposure that follows from that architecture. It is the
> authoritative source for any risk-disclosure language used elsewhere in the project.

---

## §4 Reserve Architecture

### §4.1 Primary Layer (≥ 80 % per currency)

At least 80 % of each currency's reserve is held with a designated **primary fintech/custodian
partner** for that currency. Primary partners are selected on a per-currency basis according to
liquidity, regulatory standing, and settlement speed.

### §4.2 Secondary Layer (≤ 20 % — global USDC on Stellar)

The secondary layer is **not** a like-for-like currency holding at a second fintech partner.
It is a **global USDC balance held on-chain on the Stellar network**, shared across all
supported currencies. Its purpose is:

- Emergency liquidity during a primary-partner suspension or failure.
- A settlement bridge while a replacement primary partner is onboarded.
- A de-risking buffer for FX oracle lag during market stress.

Because this buffer is denominated in USDC (not in each local currency), it does **not**
constitute a per-currency secondary reserve.

### §4.3 Stellar on-chain component

The USDC held on Stellar is governed by the `CONTRACT_RESERVE_TRACKER` smart contract.
It is redeemable 1:1 against on-chain USDC liquidity; its USD value is therefore stable but its
size relative to any individual currency reserve depends on FX rates at the time of redemption.

### §4.4 Per-currency secondary partners

There are currently **no per-currency secondary fintech partners**. If a per-currency secondary
partner arrangement is introduced in a future version, this section will document:

- The partner name and supported currency.
- The minimum holding percentage allocated to that partner.
- The currency-matching requirement (same local currency, not USDC proxy).

Until that arrangement exists, the sole secondary buffer is the global Stellar USDC pool
described in §4.2.

---

## §18 Residual-Risk Disclosures

### §18.1 On-chain / smart-contract risk

Funds held in the Stellar USDC reserve are subject to smart-contract risk, Stellar network
availability risk, and Circle/USDC redemption risk. These risks are distinct from, and in
addition to, fintech-partner custodial risk.

### §18.2 Primary-partner failure exposure (corrected statement)

> **Prior (incorrect) claim:** "No single partner failure can compromise more than 80 % of any
> single currency reserve."
>
> **Corrected statement:** A primary-partner failure **can** leave up to **80 % of that
> currency's reserve inaccessible** until the partner is restored or replaced, because the
> secondary buffer (§4.2) is a global USDC pool rather than a like-currency holding at a second
> partner. The Stellar USDC buffer can be used to bridge affected users, but it does not
> guarantee equivalent local-currency recovery at par without FX conversion.

**Risk summary table:**

| Scenario | Funds affected | Buffer available | Net exposure |
|---|---|---|---|
| Primary partner suspension (< 72 h) | Up to 80 % of impacted currency | Global Stellar USDC pool | Temporary liquidity gap; USDC bridge available |
| Primary partner insolvency | Up to 80 % of impacted currency | Global Stellar USDC pool + onboarding new partner | Potential value shortfall if USDC/local-currency FX moves adversely |
| Stellar network outage | Global USDC buffer temporarily unavailable | Primary partner still operational | Primary layer (≥ 80 %) unaffected |
| Both primary partner and Stellar offline simultaneously | Full reserve of impacted currency | None | Maximum tail-risk scenario |

### §18.3 Mitigation controls

1. **Concentration monitoring** — the `CONTRACT_RESERVE_TRACKER` contract and the
   `WeightDriftAuditService` flag primary-partner reserves that drift beyond policy thresholds.

2. **Minimum Stellar USDC floor** — the protocol maintains a minimum USDC balance on Stellar
   (`MIN_STELLAR_USDC_RESERVE` env var) to ensure a liquidity floor is always available.

3. **Partner health checks** — operational runbooks require weekly partner attestations; a
   partner that misses two consecutive attestations triggers an emergency rebalancing event.

4. **Future per-currency secondary partners** — the architecture in §4.4 is designed to accept
   per-currency secondary partners. Onboarding such a partner for any currency would reduce
   primary-failure exposure for that currency from 80 % to the primary allocation percentage
   (target: ≤ 60 %).

---

## §19 Changelog

| Date | Change | Author |
|---|---|---|
| 2026-10-21 | Initial creation — resolves W10-DOC-018: corrects §18.2 residual-risk claim to reflect that the 20 % secondary layer is a global Stellar USDC buffer, not a per-currency secondary-partner holding. | audit-fix/W10-DOC-018 |
