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

## Force-Push and Deletion Protection (W11-INC-005)

Create an active repository ruleset targeting:

- `dev` (the default branch)
- `main`
- `release/*` (the release branch naming convention)

Enable **Restrict deletions** and **Block force pushes**. Leave the bypass list
empty so repository administrators cannot bypass these protections. A
repository administrator must apply this ruleset in GitHub; this document does
not configure repository settings.

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
   - **Require signed commits** (W11-INC-008) — enforcement detail is in
     [Commit Signature Enforcement](#commit-signature-enforcement-w11-inc-008)
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

## Commit Signature Enforcement (W11-INC-008)

The incident report showed commits carrying an arbitrary author header
(`N-thnI <Niheanyi404@gmail.com>`) with no cryptographic proof of origin. GitHub
author headers are self-asserted; only a verified commit signature ties a commit
to a key that GitHub has on file for a trusted user.

### Required GitHub setting

A repository file cannot flip this setting: an organisation owner or repository
admin must enable it in the GitHub UI or with a token that has
`Administration: read` permission.

1. Open **Settings → Branches → Branch protection rules**.
2. Edit the rule for `main` and enable **Require signed commits**.
3. Keep **Do not allow bypassing the above settings** enabled so admins cannot
   merge unsigned work.
4. Repeat for `dev` and `develop`.

The setting blocks unsigned commits at push/merge time. It is the authoritative
control; everything below is repo-side verification and documentation.

Verify the live setting after making the change:

```bash
GH_TOKEN=<admin token with Administration:read> \
  node scripts/ci/check-branch-protection-signing.js \
  --repository Pi-Defi-world/acbu-backend
```

The command exits non-zero if any protected branch does not require signatures.
Keep the token out of the repository and rotate it after the audit.

### Advisory CI report

`.github/workflows/signed-commits.yml` runs
`scripts/ci/check-signed-commits.js` on every PR and prints the GitHub
verification result for each commit. The step is `continue-on-error: true` while
legacy contributors migrate to signing keys, so it reports rather than blocks.
To promote it to a required check after keys are registered:

1. Remove `continue-on-error: true` from the workflow step.
2. Add `Signed Commits / Verify signed commits` to the required status checks in
   the branch protection rule.

The same script can be run locally against any PR:

```bash
GITHUB_TOKEN=<token> node scripts/ci/check-signed-commits.js \
  --repository Pi-Defi-world/acbu-backend --pull-request 1465
```

### Maintainer key setup

Every maintainer who pushes, merges or administers these branches must sign
commits with GPG or SSH. See [CONTRIBUTING.md](../CONTRIBUTING.md#commit-signing-required)
for key generation and Git configuration. GitHub must show **Verified** on the
commit; a signature that uses an unknown or revoked key is not sufficient.

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
