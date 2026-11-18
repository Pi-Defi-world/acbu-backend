# ACBU Monorepo

This repository is now the single home for the ACBU platform. It consolidates the
previously separate repos into one clean tree.

## Layout

| Path        | Origin                                      | Imported snapshot |
|-------------|---------------------------------------------|-------------------|
| `/`         | acbu-backend (this repo)                    | existing          |
| `frontend/` | Pi-Defi-world/acbu-frontend `dev`           | `0070083` (2026-11-18) |
| `contracts/`| Pi-Defi-world/acbu-smart-contract `main`    | `c31e8ce` (2026-11-18) |

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
only** — no source history is carried over. The source repos are being archived.

## Exclusions from the snapshots

- `frontend/playwright-report/`, `frontend/test-results/` — committed test artifacts (dropped)
- smart-contract `dev`-only directories (`frontend/`, `public/`, `circuits/`, `sdk/`,
  `.vscode/`) were not part of the imported `main` snapshot

## Guardrails

- `.github/workflows/malware-ioc-scan.yml` fails any PR or push that reintroduces
  the IoC files or strings listed above.
- Branch protection should require this check plus "branches up to date" on `dev`/`main`.
- Open PRs against the archived repos must be rebased/retargeted here by their authors.

## Pending follow-ups (tracked as wave 11 issues)

- Credential rotation attestation for anyone who opened an infected clone.
- GitHub Support request to GC purged objects still reachable by SHA.
- Re-point CI pipelines to `frontend/` and `contracts/` paths.
- Dependabot findings on the imported frontend snapshot (34 at import time).
