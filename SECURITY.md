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
