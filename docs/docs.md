# ACBU Platform — Business & Technical Specification

## Table of Contents

1. [Introduction](#1-introduction)
2. [Vision & Mission](#2-vision--mission)
3. [Problem Statement](#3-problem-statement)
4. [Solution Overview](#4-solution-overview)
5. [Target Markets](#5-target-markets)
6. [Product Architecture](#6-product-architecture)
7. [Token Model (ACBU)](#7-token-model-acbu)
8. [Currency Basket Composition](#8-currency-basket-composition)
9. [Reserve & Collateral Management](#9-reserve--collateral-management)
10. [Compliance & KYC](#10-compliance--kyc)
11. [Technical Infrastructure](#11-technical-infrastructure)
12. [Business Model](#12-business-model)
13. [Go-to-Market Strategy](#13-go-to-market-strategy)
14. [Competitive Landscape](#14-competitive-landscape)
15. [Risk Management](#15-risk-management)
16. [Governance](#16-governance)
17. [Roadmap](#17-roadmap)
18. [Team & Advisors](#18-team--advisors)
19. [Financial Projections](#19-financial-projections)
20. [Appendix](#20-appendix)

---

## 1. Introduction

The African Currency Basket Unit (ACBU) is a multi-currency stable digital asset pegged to a basket of African currencies. It enables low-cost, near-instant cross-border payments across the African continent while providing a hedge against single-currency volatility.

---

## 2. Vision & Mission

**Vision:** A financially integrated Africa where every individual and business can transact across borders as seamlessly as sending a text message.

**Mission:** To build the infrastructure layer for African financial inclusion by providing a stable, transparent, and programmable unit of account denominated in African currencies.

---

## 3. Problem Statement

Cross-border payments in Africa are expensive (average cost 8–12%), slow (1–5 days settlement), and fragmented across 54+ currencies and regulatory regimes. Existing stablecoins pegged to USD or EUR introduce additional FX risk for African businesses whose costs and revenues are denominated in local currencies.

---

## 4. Solution Overview

ACBU solves these problems by:

- Maintaining a reserve basket weighted by African GDP and trade flows
- Enabling mint/burn operations so users can enter and exit with local currency
- Providing instant settlement on the Stellar blockchain (3–5 second finality)
- Charging transparent, algorithmically determined fees disclosed at point of transaction

---

## 5. Target Markets

| Segment | Description | Estimated TAM |
|---------|-------------|---------------|
| P2P Remittances | Consumer cross-border transfers | $100B/year |
| SME Payments | Cross-border B2B invoicing | $200B/year |
| Payroll | Multi-country salary disbursement | $50B/year |
| Enterprise API | Platform integration for fintechs | $30B/year |
| Government | Inter-government settlement | $20B/year |

---

## 6. Product Architecture

The ACBU platform consists of:

1. **Backend API** (Node.js/TypeScript on Express) — core business logic, KYC, transaction management
2. **Stellar Smart Contracts** (Soroban) — minting, burning, reserve tracking, oracle
3. **Fintech Partner Layer** — Flutterwave, Paystack, MTN MoMo integrations for local on/off ramps
4. **Oracle System** — real-time FX rates from multiple providers, used for basket rebalancing

---

## 7. Token Model (ACBU)

- **Type:** Algorithmic multi-currency stablecoin
- **Collateralization:** ≥ 102% reserve ratio maintained at all times
- **Minting:** User deposits local currency → system mints equivalent ACBU at current basket rate minus mint fee
- **Burning:** User submits ACBU → system redeems at current basket rate minus burn fee
- **Fee Model:** Dynamic, reserve-health-adjusted (see §12.3 and `docs/fees.md`)

---

## 8. Currency Basket Composition

The basket is rebalanced periodically based on GDP weights, trade volume, and liquidity:

| Currency | Country | Target Weight |
|----------|---------|---------------|
| NGN | Nigeria | 18% |
| ZAR | South Africa | 16% |
| EGP | Egypt | 14% |
| KES | Kenya | 12% |
| GHS | Ghana | 10% |
| ETB | Ethiopia | 8% |
| TZS | Tanzania | 7% |
| UGX | Uganda | 6% |
| XOF | West Africa (WAEMU) | 5% |
| Other | Various | 4% |

Basket weights are governed on-chain and updated via a proposal/vote mechanism.

---

## 9. Reserve & Collateral Management

- Reserves are held in a mix of USD-denominated stablecoins (USDC), local currency T-bills, and money market instruments.
- The reserve ratio is continuously monitored. If it falls below 102%, the mint fee increases to discourage further issuance.
- An independent reserve auditor provides monthly attestations published on-chain.

---

## 10. Compliance & KYC

- All users undergo KYC/AML screening (Tier 1: basic for small amounts; Tier 2: full ID for higher limits).
- Enterprise API partners are subject to enhanced due diligence (EDD).
- Transaction limits are enforced per KYC tier and jurisdiction.
- Compliance reports are available to regulators via the `/compliance` endpoint.

---

## 11. Technical Infrastructure

For backend, data-service, and reserve incident response procedures, see the [Backend and Reserve Disaster Recovery Runbook](runbooks/backend-reserve-disaster-recovery.md).

- **Runtime:** Node.js 20 + TypeScript
- **Database:** PostgreSQL via Prisma Accelerate (managed, connection-pooled)
- **Cache/Session:** MongoDB Atlas + Redis
- **Blockchain:** Stellar (Soroban smart contracts)
- **Message Queue:** RabbitMQ
- **Auth:** JWT with 2FA challenge tokens (per-instance + Redis shared deny-list)
- **Observability:** Winston logging, Prometheus metrics, structured audit trail

---

## 12. Business Model

The ACBU platform generates revenue through five distinct streams. All fees are charged at point of transaction and are transparent to users before confirmation.

### 12.1 Float Interest

ACBU holds customer reserves in interest-bearing instruments (short-dated T-bills, USDC yield). The yield earned on the float constitutes passive income.

- **Mechanism:** Reserve assets are deployed into yield-bearing instruments when not required for immediate redemption.
- **Rate:** Variable, currently targeting 3–6% annualised yield on USD-equivalent reserves.
- **Revenue Share:** 100% retained by ACBU Platform (yield is not passed to token holders).

### 12.2 Conversion Spread

A bid-ask spread of 25 basis points (BPS) is applied symmetrically to the mid-market FX rate when users convert between local currencies and ACBU.

- **Mechanism:** `buyRate = midRate × (1 − 0.00125)`, `sellRate = midRate × (1 + 0.00125)`.
- **Applicable Flows:** All local-currency on-ramp and off-ramp conversions.
- **Implementation:** `docs/fees.md` §Spread; `src/services/feePolicy/feePolicyService.ts`.

### 12.3 Transaction Fees (Mint & Burn)

**This is the primary revenue stream.** Every mint (fiat → ACBU) and every burn (ACBU → fiat) incurs a fee charged in basis points against the transaction value.

| Operation | Normal Rate | Stressed-Reserve Rate | Description |
|-----------|-------------|----------------------|-------------|
| **Mint** | **30 BPS (0.30%)** | 50 BPS (0.50%) | Charged on fiat deposit; rate rises when reserve ratio < 1.02 |
| **Burn** | **30 BPS (0.30%)** | 5–200 BPS | Currency-specific; rises when that currency's reserves are low |

**Why this is the primary revenue driver:**
- Every cross-border payment requires at least one mint and one burn operation, meaning the effective fee per transaction is **0.30% × 2 sides = 0.60%** under normal conditions.
- Transaction volume scales directly with platform usage and is independent of interest rate environments.
- The fee is charged at the moment of token creation and redemption — it is unavoidable by design.

**Fee floor and ceiling:**
- Minimum: 1 BPS (sanity floor)
- Maximum: 100 BPS for mint; 200 BPS for burn (hard caps)

**Implementation references:**
- Fee constants: `src/services/feePolicy/feePolicyService.ts`
- Fee documentation: `docs/fees.md`
- Mint controller: `src/controllers/mintController.ts`
- Burn controller: `src/controllers/burnController.ts`

**Reconciliation with §19.2:**
The financial projections in §19.2 lead with Transaction Fees as the first and largest line item, consistent with this section. At projected volumes of $500M/yr (Year 1), $2B/yr (Year 2), and $5B/yr (Year 3), transaction fees at 0.60% (two-sided) yield $3M, $12M, and $30M respectively — matching the §19.2 projections exactly.

### 12.4 Enterprise API Licensing

Enterprise and fintech partners access ACBU infrastructure via a tiered API licensing model.

- **Starter:** $500/month — up to 10,000 API calls/day
- **Growth:** $2,000/month — up to 100,000 API calls/day
- **Enterprise:** Custom pricing — unlimited calls, SLA guarantees, dedicated support

### 12.5 Ecosystem & Partner Revenue

Additional revenue sources as the platform matures:

- **Savings Vault Fees:** Performance fee on yield generated in the savings vault product.
- **Lending Pool Origination:** 1–2% origination fee on loans facilitated through the lending pool smart contract.
- **KYC Validator Rewards:** Validators earn a share of platform fees; the platform retains a portion.
- **White-Label Licensing:** Regional banks and MNOs can license the ACBU infrastructure for their own branded stablecoin products.

---

## 13. Go-to-Market Strategy

**Phase 1 (Year 1):** Target diaspora remittance corridors (Nigeria, Ghana, Kenya). Launch B2C app and partner with 3 major fintech providers.

**Phase 2 (Year 2):** Expand to SME cross-border payments. Launch Enterprise API. Onboard first bank partners.

**Phase 3 (Year 3):** Government and institutional use cases. Explore CBDC integration in willing jurisdictions.

---

## 14. Competitive Landscape

| Competitor | Type | Weakness vs. ACBU |
|------------|------|------------------|
| USDT/USDC | USD stablecoin | FX risk for African businesses |
| M-Pesa | Mobile money | Single country, no cross-border |
| Ripple ODL | XRP bridge | Requires XRP exposure, complex |
| Chipper Cash | Fintech | Not a stablecoin; high spreads |

ACBU's key differentiator is denomination in African currencies with an on-chain reserve attestation.

---

## 15. Risk Management

### 15.1 Reserve Risk
- Minimum 102% collateralization ratio enforced by smart contract.
- Monthly third-party attestation.
- Emergency redemption pause if ratio drops below 101%.

### 15.2 FX Risk
- Basket rebalancing dampens single-currency volatility.
- Currency weights are governance-controlled with time-locks.

### 15.3 Smart Contract Risk
- Soroban contracts audited by a third party before mainnet deployment.
- Upgrade mechanism requires multi-sig approval.

### 15.4 Operational Risk
- Multi-region deployment with Redis-backed session state (no single-process state).
- Circuit breakers on all fintech partner integrations.
- Graceful shutdown with RabbitMQ message persistence.

---

## 16. Governance

- **On-chain governance** via a governance token (separate from ACBU) for basket weight changes and contract upgrades.
- **Off-chain governance** via a Foundation board for fee policy, compliance decisions, and partnership approvals.
- **Emergency multisig** held by 5 of 9 founding members for urgent contract pauses.

---

## 17. Roadmap

| Quarter | Milestone |
|---------|-----------|
| Q1 2026 | Testnet launch, KYC integration, first 3 currencies |
| Q2 2026 | Mainnet beta, Flutterwave + Paystack integration |
| Q3 2026 | Full basket (10 currencies), Enterprise API launch |
| Q4 2026 | Savings vault, lending pool, 3 bank partners |
| Q1 2027 | SME cross-border product, 10 fintech partners |
| Q2 2027 | Government pilot, CBDC integration discussions |

---

## 18. Team & Advisors

Details available under NDA for qualified investors. Core team has backgrounds in African fintech, Stellar development, and central bank operations.

---

## 19. Financial Projections

### 19.1 Key Assumptions

| Assumption | Year 1 | Year 2 | Year 3 |
|------------|--------|--------|--------|
| Transaction Volume (annualised) | $500M | $2B | $5B |
| Average Mint Fee (BPS) | 30 | 30 | 30 |
| Average Burn Fee (BPS) | 30 | 30 | 30 |
| Reserve Float Yield | 4.0% | 4.5% | 5.0% |
| Average Reserve Base | $25M | $80M | $150M |
| Enterprise API Customers | 5 | 20 | 60 |
| Average Enterprise ARPU/yr | $18,000 | $22,000 | $28,000 |

### 19.2 Projected Revenue by Stream

All figures in USD. Transaction fee projections assume **0.30% per side × 2 sides = 0.60%** effective fee per round-trip, consistent with §12.3.

| Revenue Stream | Year 1 | Year 2 | Year 3 |
|----------------|--------|--------|--------|
| **Transaction fees (0.3% × 2 sides)** | **$3,000,000** | **$12,000,000** | **$30,000,000** |
| Float interest | $1,000,000 | $3,600,000 | $7,500,000 |
| Conversion spread (25 BPS) | $625,000 | $2,500,000 | $6,250,000 |
| Enterprise API licensing | $90,000 | $440,000 | $1,680,000 |
| Ecosystem (savings, lending, KYC) | $50,000 | $500,000 | $3,000,000 |
| **Total Revenue** | **$4,765,000** | **$19,040,000** | **$48,430,000** |

**Notes on §19.2:**
1. Transaction fees are the **primary revenue driver** at 63% of Year 1 total, 63% of Year 2, and 62% of Year 3 — consistent with their definition as the primary stream in §12.3.
2. Float interest is the second largest stream, dependent on reserve base growth.
3. Conversion spread revenue scales with volume but is smaller than transaction fees because it is 25 BPS vs. an effective 60 BPS for the mint+burn round-trip.
4. Enterprise API and ecosystem revenues are meaningful at scale but represent diversification rather than primary income.

### 19.3 Cost Structure

| Cost Category | Year 1 | Year 2 | Year 3 |
|---------------|--------|--------|--------|
| Engineering & Product | $1,500,000 | $3,000,000 | $5,000,000 |
| Compliance & Legal | $400,000 | $600,000 | $900,000 |
| Infrastructure & Cloud | $200,000 | $400,000 | $700,000 |
| Fintech Partner Fees | $250,000 | $800,000 | $2,000,000 |
| Marketing & BD | $300,000 | $800,000 | $1,500,000 |
| G&A | $200,000 | $400,000 | $600,000 |
| **Total Costs** | **$2,850,000** | **$6,000,000** | **$10,700,000** |

### 19.4 EBITDA

| | Year 1 | Year 2 | Year 3 |
|--|--------|--------|--------|
| Total Revenue | $4,765,000 | $19,040,000 | $48,430,000 |
| Total Costs | $2,850,000 | $6,000,000 | $10,700,000 |
| **EBITDA** | **$1,915,000** | **$13,040,000** | **$37,730,000** |
| **EBITDA Margin** | **40%** | **68%** | **78%** |

---

## 20. Appendix

### 20.1 Fee Calculation Examples

**Example: $1,000 remittance Nigeria → Kenya**

1. User deposits $1,000 equivalent in NGN.
2. System charges **mint fee = 0.30%** → fee = $3.00.
3. ACBU minted: $997.00 worth.
4. ACBU transferred to recipient's wallet (no additional fee).
5. Recipient burns ACBU for KES.
6. System charges **burn fee = 0.30%** → fee = $2.99.
7. Recipient receives $994.01 equivalent in KES.

Total fee: $5.99 / $1,000 = **0.60%** — significantly below the industry average of 8–12%.

### 20.2 Reserve Ratio Monitoring

| Ratio | Status | Action |
|-------|--------|--------|
| ≥ 1.05 | Healthy | Normal operations |
| 1.02–1.05 | Adequate | Normal operations |
| < 1.02 | Stressed | Mint fee increases to 50 BPS |
| < 1.01 | Critical | Emergency pause considered |

### 20.3 Glossary

- **BPS:** Basis points. 1 BPS = 0.01%. 30 BPS = 0.30%.
- **Mint:** Converting fiat into ACBU tokens.
- **Burn:** Redeeming ACBU tokens for fiat.
- **Reserve Ratio:** Total reserve value / total ACBU outstanding value.
- **Basket:** The weighted collection of African currencies that ACBU tracks.
- **JTI:** JWT ID — a unique identifier embedded in each JWT used to prevent replay attacks.

### 20.4 Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-10-19 | ACBU Engineering | Initial creation; fixes W10-DOC-003 — adds transaction/mint-burn fee as §12.3 primary revenue stream; reconciles §19.2 amounts ($3M/$12M/$30M) with §12.3 fee model (0.30% × 2 sides × volume). |
