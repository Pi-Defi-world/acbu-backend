# Branch Protection & Required CI Checks

This document defines the required branch protection rules and status checks
for `main`, `dev` and `develop` in `Pi-Defi-world/acbu-backend`. These rules
prevent merging broken or unreviewed code.

---

## Blocking CI jobs

`.github/workflows/ci.yml` runs these jobs on every pull request. They are
fail-closed: none of them may set `continue-on-error: true`, and their `run:`
commands must not swallow exit codes (`|| true`, `|| echo ...`). A failing
lint, test or build job therefore fails the workflow run.

| Job | Status check | What it verifies |
|---|---|---|
| `secret-scan` | `CI / Secret Scan (gitleaks)` | No secrets in the change or its history |
| `lint-and-format` | `CI / Lint, Format & Security Audit` | ESLint, Prettier, high-severity dependency advisories |
| `test` | `CI / Test` | Full Jest suite against real Postgres, MongoDB and RabbitMQ |
| `build` | `CI / Build` | Prisma client generation and a clean TypeScript build |
| `ci-gate` | `CI / CI Gate` | Fail-closed aggregate of the four jobs above |

`ci-gate` is the recommended single required check: it runs with
`if: always()` and fails when any of `secret-scan`, `lint-and-format`, `test`
or `build` does not finish with `success` (failed, cancelled or skipped), so
no failing test, lint or build can be merged.

`validate-migrations` (`CI / Validate Migrations`) runs only on pull requests
and depends on `build`. Require it as well if migration safety must gate
merges. `license-check` (`CI / License Check`) and the push-only
`docker-build-publish` job are not merge gates.

---

## Configuring Branch Protection on GitHub

1. Navigate to **Settings → Branches** in the repository.
2. Click **Add branch protection rule**.
3. Set **Branch name pattern** to `main` (repeat the whole section for `dev`
   and `develop`).
4. Enable the following options:

   - **Require a pull request before merging**
     - Require at least **1 approval** (2 for production hotfixes)
     - Dismiss stale reviews when new commits are pushed
   - **Require status checks to pass before merging**
     - Enable "Require branches to be up to date before merging"
     - Add each check name from the list below
   - **Require conversation resolution before merging**
   - **Do not allow bypassing the above settings** (applies to admins too)
   - **Restrict who can push to matching branches** — limit to release
     automation or designated merge bots

---

## Check Names to Configure

Copy these exact strings into the required status checks UI:

```
CI / Secret Scan (gitleaks)
CI / Lint, Format & Security Audit
CI / Test
CI / Build
CI / CI Gate
```

> **Note:** GitHub names checks `<workflow name> / <job name>`, not
> `<job> / <step>`. The workflow is named `CI` and the job names above come
> from the `name:` fields in `.github/workflows/ci.yml`. If the workflow or a
> job is renamed, update both the workflow and this document.

---

## Snyk Security Scan

The repository also runs `.github/workflows/snyk.yml` on pull requests and
pushes to `main`/`dev`/`develop`. It skips when `SNYK_TOKEN` is unavailable or
when the pull request comes from a fork, so it is not a merge gate. If Snyk
runs in your environment, consider requiring:

```
Snyk Dependency Scan / snyk-scan
```

---

## Labels

The CI pipeline recognises the following PR labels:

| Label | Effect |
|---|---|
| `allow-destructive-migration` | Permits Prisma migrations that drop columns, tables, or indexes |

No other labels currently gate CI steps.

---

## Rationale

Without these protections, a PR with failing tests or broken TypeScript can be
merged, breaking `main`/`dev` and blocking other contributors. These rules
encode the team's minimum quality bar as a technical enforcement, not just a
process guideline.

See also: [CONTRIBUTING.md](../CONTRIBUTING.md) for the full PR workflow.
