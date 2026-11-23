# Branch Protection & Required CI Checks

This document defines the required CI checks for `main` and `develop`, and
history-protection rules for the `dev` (default), `main`, and `release/*`
branches of `Pi-Defi-world/acbu-backend`.

---

## Required Status Checks — `main`

The following GitHub Actions CI jobs **must pass** before any pull request can
be merged to `main`. Configure them under
**Settings → Branches → Branch protection rules → main** with
"Require status checks to pass before merging" enabled.

| Check name | What it verifies |
|---|---|
| `lint-and-test / Lint` | ESLint passes on all changed TypeScript files |
| `lint-and-test / Format check` | Prettier formatting is consistent |
| `lint-and-test / Audit dependencies for critical vulnerabilities` | No critical CVEs in the dependency tree |
| `lint-and-test / Gate destructive Prisma migrations` | Destructive schema migrations carry the `allow-destructive-migration` label |
| `lint-and-test / Run tests` | All Jest tests pass (full suite on `main`/`develop`, changed files on PRs) |
| `lint-and-test / Build` | TypeScript compiles to JavaScript without errors |
| `Malware IoC Scan / ioc-scan` | Scans for known malware IoC files and content strings (e.g. dist/setup.js, fa-solid woff2 files, folderOpen task triggers) |

> These checks map directly to the steps in `.github/workflows/ci.yml` under
> the `lint-and-test` job.

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
3. Set **Branch name pattern** to `main`.
4. Enable the following options:

   - **Require a pull request before merging**
     - Require at least **1 approval** (2 for production hotfixes)
     - Dismiss stale reviews when new commits are pushed
   - **Require status checks to pass before merging**
     - Enable "Require branches to be up to date before merging"
     - Add each check name from the table above
   - **Require conversation resolution before merging**
   - **Do not allow bypassing the above settings** (applies to admins too)
   - **Restrict who can push to matching branches** — limit to release
     automation or designated merge bots

5. Repeat for the `develop` branch (same checks, 1 approval minimum).

---

## Check Names to Configure

Copy these exact strings into the required status checks UI:

```
lint-and-test / Lint
lint-and-test / Format check
lint-and-test / Audit dependencies for critical vulnerabilities
lint-and-test / Gate destructive Prisma migrations
lint-and-test / Run tests
lint-and-test / Build
Malware IoC Scan / ioc-scan
```

> **Note:** GitHub uses the format `<job-name> / <step-name>` for status check
> names when the job is `lint-and-test` and the step has a `name:` field.
> If your repository uses a different CI job name, adjust accordingly.

---

## Snyk Security Scan

The repository also runs a Snyk workflow (`.github/workflows/snyk.yml`) on
push to `main`. Consider adding its status check too:

```
security / Snyk Open Source
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
merged, breaking the `main` branch and blocking other contributors. These rules
encode the team's minimum quality bar as a technical enforcement, not just a
process guideline.

See also: [CONTRIBUTING.md](../CONTRIBUTING.md) for the full PR workflow.
