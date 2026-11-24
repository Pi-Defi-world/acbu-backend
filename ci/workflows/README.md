# SAST Workflows

This directory contains the shared Static Application Security Testing (SAST)
workflows for the ACBU platform. They address **W2-D-001** — no SAST / CodeQL /
Semgrep anywhere in the platform.

## What's included

| File | Tool | Purpose |
|------|------|---------|
| `codeql.yml` | GitHub CodeQL | Deep semantic analysis of the codebase; results surface in the GitHub Security tab |
| `semgrep.yml` | Semgrep | Fast, rule-based scanning using the repo-root `.semgrep.yml` rules plus OWASP Top Ten and security-audit rulesets |

## Installation

Copy the workflow files into each repository's `.github/workflows/` directory:

```bash
cp ci/workflows/codeql.yml  .github/workflows/codeql.yml
cp ci/workflows/semgrep.yml .github/workflows/semgrep.yml
```

Also copy the shared rule set to the repository root:

```bash
cp .semgrep.yml .
```

## Behavior

- **Triggers:** Runs on every push to `main`/`develop` and on every pull request.
- **Blocking:** Both jobs fail on `ERROR`-severity findings (`--error` in Semgrep,
  CodeQL `security-and-quality` query suite). Configure the jobs as **required
  status checks** in the repository's branch protection rules so PRs are blocked
  on critical findings.
- **Reporting:** CodeQL uploads results to the GitHub Security tab. Semgrep
  uploads a JSON report as a build artifact.

## Required status checks

In each repository's **Settings → Branches → Branch protection rules**, add the
following as required status checks:

- `CodeQL / Analyze`
- `Semgrep SAST`

This satisfies the acceptance criterion: *"SAST runs on every PR and blocks on
critical findings."*
