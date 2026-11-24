# USSD / SMS Fallback Channel (Proposal)

Issue: #974 (W10-S-014)
Status: **Proposed. Not implemented.** Until this ships, every user flow in the product requires the app and an internet connection.

## 1. Why

ACBU is positioned around mobile money and financial inclusion, but every current flow assumes a smartphone app and a data connection. Users on feature phones, or with intermittent or expensive data, cannot use the product. This contradicts the inclusion principle (see §1.4 of the product docs) and limits adoption in the target markets.

## 2. Goals and non-goals

**Goals**

- Core money flows work from any phone, including feature phones, with no mobile data.
- A USSD/SMS user and an app user share the same account, balance and history.
- Security is proportionate: weaker channel, lower limits.

**Non-goals (initially)**

- Full feature parity with the app (business tools, lending, enterprise).
- KYC document capture over USSD.
- Replacing the app. USSD/SMS is a fallback, not a new primary client.

## 3. Channel roles

| Channel | Style | Used for |
| ------- | ----- | -------- |
| USSD | Synchronous, menu-driven session (short screens, sessions of a few minutes; exact limits vary by operator) | Balance, send, airtime and bills, mini statement, PIN change |
| SMS | Asynchronous, one-way by default | Receipts, incoming-funds alerts, security alerts, one-time codes |

## 4. Proposed user flows

| Flow | USSD | SMS | Notes |
| ---- | ---- | --- | ----- |
| Link phone and set USSD PIN | Not available | Confirmation message | Done in the app (Me > Settings) or via an agent. An unregistered number gets a short "register in the app" message. |
| Check balance | Menu option 1 + PIN | Off by default (privacy) | Balance shown only on screen. |
| Send to a phone number | Recipient, amount, confirm screen showing recipient name, PIN | Receipt to sender and recipient | Idempotency key per attempt so a dropped session cannot double-send. |
| Receive funds | Not needed | Incoming-funds alert | |
| Mini statement | Last 5 transactions | None | |
| Airtime and bills | Pick biller, account, amount, PIN | Receipt | Reuses the existing bills catalog. |
| Cash in / cash out | Start request, confirm, PIN | Status messages | Depends on mobile-money partner support. Later phase. |
| PIN reset / account recovery | Not available | Not available | App or agent only. |

Example USSD main menu:

```
ACBU
1. Balance
2. Send
3. Airtime & bills
4. Mini statement
5. Settings (PIN, language)
```

## 5. Security considerations

- Separate USSD PIN (not the app password). Stored hashed, locked after 3 failed attempts, reset only through the app or an agent.
- Lower per-transaction and daily limits than the app.
- SIM-swap risk: add a cool-down on a newly seen SIM where the operator provides a signal, and alert the user on all other channels.
- Never execute a money-moving command from an inbound SMS without PIN verification. SMS is for receipts and alerts.
- No sensitive detail in SMS: mask account identifiers and keep balances out by default.
- Rate-limit by phone number, log every session for audit, and expire idle sessions quickly.

## 6. Proposed architecture

```
Phone -> mobile operator -> USSD/SMS aggregator -> channel API (backend) -> existing ledger services
```

- **Backend** (acbu-backend): channel API, session state keyed by session id, PIN verification, limits, idempotency.
- **Gateway:** aggregator or direct operator integration, chosen per launch market.
- **Frontend (this repo):** phone and USSD PIN registration in settings, localized strings (reuse `i18n/`), help text, and honest messaging that the app is not required for core flows.

## 7. Roadmap

| Phase | Scope |
| ----- | ----- |
| 0. Discovery | Pick launch market(s), aggregator or operator, short-code and regulatory requirements, per-session cost model. |
| 1. Read and notify | SMS receipts and alerts, USSD balance and mini statement, phone and PIN registration in the app. |
| 2. Transfers | USSD send with limits, idempotency and SIM-swap protections. |
| 3. Bills and cash | Airtime and bill payment, cash in/out through mobile-money partners. |
| 4. Reach | More languages, agent-assisted onboarding, accessibility improvements. |

Success measures: share of users reached, USSD session completion rate, mid-session drop rate, fraud rate, and cost per session.

## 8. Open questions

- Shared short code or one per operator, and who bears per-session cost?
- Which flows require which KYC tier under local regulation?
- Which markets expose SIM-swap signals?
- Should SMS commands (not just receipts) ever be supported offline?