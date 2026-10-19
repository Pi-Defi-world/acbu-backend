# Security Policy

## Reporting a Vulnerability

If you believe you have found a security vulnerability in `acbu-backend`, please report it privately and do not open a public issue.

Use GitHub's private vulnerability reporting for this repository:

- Go to the repository's **Security** tab
- Select **Report a vulnerability**
- Provide the details requested in the form

If private reporting is unavailable, contact the repository maintainers through GitHub as privately as possible and avoid posting exploit details publicly.

## What To Include

Please include as much of the following as you can:

- A short description of the issue
- The affected endpoint, service, or workflow
- Steps to reproduce
- Any proof of concept, logs, or screenshots
- The potential impact
- Whether the issue is currently exploitable in production or only in development

## Response Expectations

We will acknowledge security reports as soon as practical, investigate privately, and coordinate a fix before any public disclosure when possible.

Please allow reasonable time for triage and remediation before sharing details publicly.

## Static Application Security Testing (SAST)

This repository runs **CodeQL** and **Semgrep** on every push and pull request to
detect security vulnerabilities before they ship.

### CI Workflows
- **codeql.yml**: GitHub CodeQL with the `security-and-quality` query suite. Results
  surface in the GitHub Security tab.
- **semgrep.yml**: Semgrep using the repo-root `.semgrep.yml` rules plus the OWASP
  Top Ten and security-audit rulesets. Fails on `ERROR`-severity findings.

Both jobs are configured as **required status checks** so PRs are blocked on
critical findings. Shared workflow templates live in `ci/workflows/` and can be
reused across the platform's repositories (see `ci/workflows/README.md`).

## Dependency Vulnerability Scanning

This repository gates every PR on dependency vulnerabilities using checks that
require **no secrets**, so they always run — including on fork PRs, which never
receive repository secrets:

- **`pnpm audit --audit-level high`** — runs in the main CI workflow's Lint job
  on every push and PR. Fails the build on any high-or-above severity finding
  in the resolved dependency tree.
- **Dependency Review** (`dependency-review.yml`, `actions/dependency-review-action`)
  — runs on every PR and fails on high-or-above severity vulnerabilities newly
  introduced by that PR's dependency changes.

**Snyk** (`snyk.yml`) also runs a deeper scan, but only when the `SNYK_TOKEN`
secret is configured and the PR is not from a fork (secrets are never exposed
to fork PRs). When it cannot run it posts a clear skip notice to the job
summary rather than showing a plain, unexplained green check. Snyk is a
**supplementary** scan — the two checks above are what actually block a merge
when Snyk itself does not run.

## Secret Scanning (Gitleaks)

This repository uses **gitleaks** to detect secrets in the git history and block commits containing credentials.

### CI Workflow
- **gitleaks.yml**: Runs on every push and PR to block new secrets from entering the codebase
- Full fetch (`fetch-depth: 0`) ensures the entire commit history is scanned on each PR

### Manual History Scan (Maintainers Only)
For a comprehensive audit of existing history, maintainers can run:
```bash
./scripts/ci/scan-gitleaks-history.sh
```

This script:
1. Scans the entire git history for secrets
2. Generates a detailed report if secrets are found
3. Provides guidance on secret rotation and history cleanup

**If secrets are discovered:**
- Immediately rotate the compromised secrets in your secrets manager
- Use `git-filter-repo` to remove commits containing secrets (requires careful coordination)
- Force push to rewrite history (notify the team before doing this)

### Safe Harbor

We consider good-faith security research to be helpful. Please avoid:

- Accessing data you do not own or are not authorized to access
- Modifying or deleting data
- Disrupting service availability
- Exfiltrating secrets, credentials, or personal data

If you accidentally encounter sensitive information during testing, stop immediately and report it through the private channel above.
