# Orphaned PR migration ledger (W11-MIG-010, #1338)

When `acbu-smart-contract` and `acbu-frontend` are archived, their open pull
requests disappear with them. This ledger records every stranded PR, the commit
it currently points at, the monorepo path it belongs to, and the command that
replays it.

The monorepo import (the `contracts/` and `frontend/` trees) is a separate
change from the source repositories' `dev` snapshots. Until that import lands,
these PRs cannot be cherry-picked directly: their paths are repository-root
relative (`acbu_minting/src/lib.rs`, `hooks/useOnlineStatus.ts`, ...), whereas in
the monorepo they live under `contracts/` and `frontend/` respectively. The
migration tool below performs that path translation and filters the files that
must not enter the repository.

## Inventory

Snapshot date: 2026-11-20. All PRs are open at the time of writing.

### `contracts/` (source: `Pi-Defi-world/acbu-smart-contract`)

| PR | Head ref | Head SHA | Title | Priority |
|----|----------|----------|-------|----------|
| [#1088](https://github.com/Pi-Defi-world/acbu-smart-contract/pull/1088) | `mubashqoz-eng:fix/issue-986-oracle-twap` | `6be2abc6` | Price mint/burn with a 24h TWAP instead of the spot rate | P0 |
| [#1087](https://github.com/Pi-Defi-world/acbu-smart-contract/pull/1087) | `Kinghezzy:drips/1039-1042` | `d6f48b1e` | Align Soroban SDK pins, add divergence guard, update oracle test protocol version | P0 |
| [#1086](https://github.com/Pi-Defi-world/acbu-smart-contract/pull/1086) | `Masked18:fix/w10-z-009-verifier-supply-chain` | `02c233df` | Document ZK verifier supply-chain security | P1 |
| [#1084](https://github.com/Pi-Defi-world/acbu-smart-contract/pull/1084) | `Masked18:fix/w10-z-003-sdk-submit-proof-public-inputs` | `0280de29` | Pass `public_inputs` to `verify()` from the SDK; fix `zk_verifier` compilation | P1 |
| [#1083](https://github.com/Pi-Defi-world/acbu-smart-contract/pull/1083) | `Daniel202251:fix/w10-sec-002-kyc-policy` | `1c0d1097` | Enforce on-chain ZK KYC policy | P0 |
| [#1081](https://github.com/Pi-Defi-world/acbu-smart-contract/pull/1081) | `bless22611:fix/W10-S-011-quorum-matrix` | `9694b57c` | Authoritative quorum matrix; reconcile multisig | P0 |
| [#1080](https://github.com/Pi-Defi-world/acbu-smart-contract/pull/1080) | `Thadd102:fix/w10-sec-013` | `64945cc2` | Oracle 5% deviation cap, review-flag gate, pause on breach | P0 |
| [#1074](https://github.com/Pi-Defi-world/acbu-smart-contract/pull/1074) | `Stealth-cloud-droid:fix/978-usdc-mint-collateralization` | `351350cf` | Gate USDC minting on conversion quota | P0 |
| [#1072](https://github.com/Pi-Defi-world/acbu-smart-contract/pull/1072) | `nazteeemba:fix/1051-w10-rust-008-assert-recipient-is-account` | `c480af05` | Clean up `assert_recipient_is_account`; W10-RUST-008 | P1 |
| [#1071](https://github.com/Pi-Defi-world/acbu-smart-contract/pull/1071) | `dominiccreates:fix/w10-sec-008-mixer-withdraw-recipient-binding` | `6e617ab8` | Document mixer withdraw recipient binding | P1 |
| [#1070](https://github.com/Pi-Defi-world/acbu-smart-contract/pull/1070) | `dominiccreates:fix/w10-sec-009-vk-hash-commitment` | `32ebe5ec` | Pin and commit the ZK verification key hash | P0 |
| [#1069](https://github.com/Pi-Defi-world/acbu-smart-contract/pull/1069) | `johnvin489-cloud:test/w10-sec-004-fiat-mint-attestation` | `3444fb44` | Test dual authorization for fiat minting | P1 |
| [#1068](https://github.com/Pi-Defi-world/acbu-smart-contract/pull/1068) | `olacodes-01:fix/w10-s-017-oracle-validator-independence` | `b672883c` | Require distinct oracle validator keys | P0 |
| [#942](https://github.com/Pi-Defi-world/acbu-smart-contract/pull/942) | `Tobore2000:dev` | `cad81e53` | Lending liquidation/overdue path | P2 |
| [#912](https://github.com/Pi-Defi-world/acbu-smart-contract/pull/912) | `shobhamerabacha-star:feat/admin-roles` | `8be0fd67` | RBAC admin roles | P2 |
| [#911](https://github.com/Pi-Defi-world/acbu-smart-contract/pull/911) | `rupesh-kumar-sah:fix/issue-805-upgrade-deprecated-actions` | `e6c0bc46` | Upgrade deprecated `actions/cache@v3` / `upload-artifact@v3` | P2 |
| [#909](https://github.com/Pi-Defi-world/acbu-smart-contract/pull/909) | `rupesh-kumar-sah:fix/remove-stale-node-pins-906` | `18b7caf8` | Remove stale Node toolchain pins from the Rust root | P2 |
| [#571](https://github.com/Pi-Defi-world/acbu-smart-contract/pull/571) | `JoaquinSkorg:fix/test.rs` | `11b74bc6` | Issue 229 test fixes | P2 |

### `frontend/` (source: `Pi-Defi-world/acbu-frontend`)

| PR | Head ref | Head SHA | Title | Priority |
|----|----------|----------|-------|----------|
| [#751](https://github.com/Pi-Defi-world/acbu-frontend/pull/751) | `onlyone58:fix/ssr-guard-use-online-status` | `65292d2a` | Add SSR guard for `window` in `useOnlineStatus` | P0 |

Priority reflects security impact, not the order in the source repository:
P0 items carry money-path or verifier-enforcement changes, P1 supports them, and
P2 is tooling/test drift that can follow.

## Preservation first

Archival must not be blocked on merging all nineteen ports. Export the patches
before archiving so the code survives even if the forks are deleted:

```bash
scripts/migrate-orphaned-prs.sh --export /tmp/acbu-orphaned-prs
```

This writes one path-prefixed patch per PR, plus a `MANIFEST.txt` with the
source ref and SHA. The exported patches apply at the monorepo root once the
`frontend/` and `contracts/` trees exist.

## Porting a PR

```bash
# 1. List the plan (no network).
scripts/migrate-orphaned-prs.sh

# 2. Validate a single PR without changing the worktree.
scripts/migrate-orphaned-prs.sh --check 1083

# 3. Create one feature branch per PR and apply it.
scripts/migrate-orphaned-prs.sh --apply 751
scripts/migrate-orphaned-prs.sh --apply 1083
```

Pass several numbers to process them in order. The script creates `port/pr-<number>`, applies the diff with `--3way`,
and commits it with the original PR reference. Conflicts abort that PR only;
the branch is reset so the next PR starts from clean `HEAD`.

Per-PR checklist before opening the replacement PR:

1. Review the applied diff; the source branches are stale relative to the
   imported `dev` snapshots, so `--3way` can merge silently in the wrong place.
2. Run the contract suite for `contracts/` changes and the frontend suite for
   `frontend/` changes.
3. Open the replacement PR against `dev` with `Original: <source PR URL>` in the
   body and close the source PR.
4. Tick the PR off in the inventory above (or delete the row once merged).

## Files the port deliberately drops

The sources contain local-only and generated files that must not be replayed:

- `.env` / `.env.*` (local secrets; PR #1088 adds one)
- `.vscode/*`, `.claude/*` (editor/agent state; the source repos were purged of
  a malicious `tasks.json` auto-run payload during archival preparation)
- `dist/setup.js`, `*.woff2`, `*.llf` (known malware indicators)
- `build`, `target/`, `node_modules/` (compiled output)
- `error*.txt`, `final.txt`, `*.bat`, `nodemon.json` (scratch files)

These filters are implemented in `scripts/migrate-orphaned-prs.sh` and apply to
both exports and direct applies.

## Archival checklist

- [ ] Export patches with `--export` and store them with the release artifacts.
- [ ] Port P0 PRs (#1083, #1080, #1070, #1088, #1074, #1081, #1068, #751).
- [ ] Port P1 PRs (#1086, #1084, #1072, #1071, #1069).
- [ ] Port P2 PRs (#942, #912, #911, #909, #571).
- [ ] Transfer the remaining open issues from both repositories.
- [ ] Archive both source repositories.
