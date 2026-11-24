# ACBU Monorepo

This repository is now the single home for the ACBU platform. It consolidates the
previously separate repos into one clean tree.

## Layout

| Path         | Origin                                  | Imported snapshot      |
| ------------ | --------------------------------------- | ---------------------- |
| `/`          | acbu-backend (this repo)                | existing               |
| `frontend/`  | Pi-Defi-world/acbu-frontend `dev`       | `0070083` (2026-11-18) |
| `contracts/` | Pi-Defi-world/acbu-smart-contract `dev` | `3160312` (2026-11-18) |

## Why a fresh-history import

The source repos were rejected by the Drips Wave security review after a malware
campaign (see the Wave team IoC advisory) planted supply-chain droppers in their
git histories:

- `dist/setup.js` + `public/fonts/fa-solid-500.woff2` (identical obfuscated Node loaders)
- `.vscode/tasks.json` (`eslint-check` task, `runOn: folderOpen` auto-execution)
- `.vscode/settings.json` (`task.allowAutomaticTasks: true`)
- `frontend/zk-comply-frontend/package.json` (`preinstall: node dist/setup.js`)

Those histories were purged (git-filter-repo + force-push), but to guarantee the
monorepo carries zero attacker commits, the code was imported as **tree snapshots
only** -- no source history is carried over. The source repos are being archived.

## Snapshot source rationale

- `frontend/` imports the default branch `dev` (post-purge, IoC-verified).
- `contracts/` imports the default branch `dev` (post-purge, IoC-verified).
  The earlier `main` snapshot was rejected: `main` and `dev` diverged in
  2026-03, and `dev` carries merged wave-10 security fixes (W10-C-002/003/004)
  plus all 18 open PR targets that `main` lacks.
- Tracked files that the backend root `.gitignore` or nested `.gitignore`
  rules would silently drop (e.g. `frontend/pnpm-lock.yaml`,
  `contracts/**/test_comprehensive.rs`, `contracts/.vscode/*`,
  `contracts/frontend/zk-comply-frontend/package-lock.json`) were force-added
  so the snapshot matches the source trees 1:1.

## Exclusions from the snapshots

- `frontend/playwright-report/`, `frontend/test-results/` -- committed test artifacts (dropped)
- `frontend/hooks/.use-navigation-guard.ts.swp` -- editor swap file (dropped)

Note: `contracts/.github/workflows/*` and `frontend/.github/workflows/*` are
inert inside a monorepo (GitHub only executes workflows from the repository
root `.github/workflows/`). Re-pointing CI to the new paths is tracked as a
wave 11 issue.

## Toolchain

Node.js is pinned once, at the repository root, in `.nvmrc` and `.tool-versions`
(Node 22 LTS). Subdirectories intentionally do **not** carry their own
`.nvmrc`/`.node-version` files: stale per-directory pins caused `nvm` and CI
runners to switch to a different Node major when moving between `contracts/` and
`frontend/`. `tests/nodeVersionPolicy.test.ts` guards the single-source-of-truth
policy, and all root CI workflows use the same Node 22 version.

## Guardrails

- `.github/workflows/malware-ioc-scan.yml` fails any PR or push that reintroduces
  the IoC files or strings listed above.
- Branch protection should require this check plus "branches up to date" on `dev`/`main`.
- Open PRs against the archived repos must be rebased/retargeted here by their authors.

## Pending follow-ups (tracked as wave 11 issues)

- Credential rotation attestation for anyone who opened an infected clone.
- GitHub Support request to GC purged objects still reachable by SHA — the
  ready-to-submit ticket is in
  `docs/incident/W11-INC-001-github-support-request.md`; an org owner must file
  it because GitHub Support cannot be contacted from a PR. Reachability can be
  verified with `scripts/ci/check-orphaned-attacker-commits.js`.
- Re-point CI pipelines to `frontend/` and `contracts/` paths (nested workflows are inert).
- Dependabot findings on the imported frontend snapshot (34 at import time).
- Retire the stale `acbu-frontend` gitlink (submodule pointer, no `.gitmodules`).
