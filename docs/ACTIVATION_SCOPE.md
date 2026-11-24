# Wallet Activation Scope — Stellar-only (W10-P-007)

## Decision

Wallet activation in this backend is **Stellar-only**. There is no Pi Network
bridge, Pi Platform API integration, or Pi SDK dependency in this codebase.

## Background

Wave 10 audit item W10-P-007 flagged scope drift: `STRATEGY.md` and
`KYC_LAYER.md` in the companion ACBU-DOCUMENTATION repository still referenced
a Pi Network bridge as "in-scope-uncertain," but no such integration was ever
implemented here. This caused reviewer confusion about whether Pi Mainnet /
Open-Mainnet status or Pi Platform API changes needed to be tracked.

## What was removed / cleaned up

| Location | What changed |
|---|---|
| `src/config/env.ts` | Removed dead `bootstrapProfile.includes("pi") ? "PI" : "XLM"` branch; `nativeAssetCode` now defaults unconditionally to `"XLM"` (override via `STELLAR_NATIVE_ASSET_CODE`). |
| `src/services/stellar/activationService.ts` | Updated comment from "for example PI vs XLM" to "defaults to XLM". |
| `src/services/stellar/activationService.test.ts` | Replaced `"PI"` / `"pi-testnet"` mock values with `"XLM"` / `"xlm-testnet"`. |
| `CHANGELOG.md` | Historical entry "Add Pi bridge support for wallet activation" is preserved as-is (historical record). |

**Not changed:**
- `"Pi-Defi-world"` references in `.github/CODEOWNERS`, workflow files, and
  code comments — this is the GitHub organisation name, not a Pi Network
  reference.
- `src/services/stellar/sorobanInvokeErrors.ts` reference to
  `ACBU-DOCUMENTATION/TESTNET_CUSTODIAL_BOOTSTRAP.md` — this is a Stellar
  testnet deployment runbook, not Pi Network documentation.
- `TESTNET_CUSTODIAL_BOOTSTRAP` environment variable — retained as a
  diagnostics/runbook label; it no longer drives the `nativeAssetCode` value.

## Pi Network status — out of scope

Pi Network Mainnet / Open-Mainnet operational status is **not monitored** and
does **not need to be** until a deliberate integration decision is made. No
alerts, health checks, or CI jobs are required for Pi Network.

If a Pi Network integration is ever scoped in the future, it should be
introduced as a new, explicitly gated feature (separate service, separate env
var namespace) and tracked via a dedicated audit item.

## Activation architecture

All wallet activation is performed via the Stellar `createAccount` operation.
The funding asset is always the Stellar network-native asset (XLM on mainnet,
XLM on testnet). Callers receive the asset code in the `fundingAssetCode` field
of the `ActivationResult` response; the value can be overridden at deployment
time via `STELLAR_NATIVE_ASSET_CODE` if a test network uses a different
native asset code.

See `src/services/stellar/activationService.ts` for implementation and
`ENV_VARS.md` (Stellar section) for configuration.
