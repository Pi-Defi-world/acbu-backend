# Security Audit Webhooks & Administrative Event Monitoring

This document defines how administrative GitHub events (collaborator/membership changes, repository changes, and branch protection modifications) are streamed to external security monitoring channels (Slack, Discord, or SIEM) to resolve **W11-INC-015**.

---

## Threat Model

Without external streaming of GitHub administrative events, an attacker or compromised maintainer account could:

- Add an unauthorized collaborator or elevate team permissions
- Weaken or delete branch protection rules or repository rulesets
- Change repository visibility (e.g., making a private repository public) or add unauthorized deploy keys

Streaming these events out-of-band to a dedicated security channel or SIEM ensures immediate visibility before malicious commits can be merged.

---

## Monitored Events

### Organization-Level Webhook (`--org`)

| Event | What it detects |
|---|---|
| `membership` | Users added to or removed from organization teams |
| `member` | Collaborators added, removed, or having permissions changed on a repository |
| `organization` | Organization member invitations, removals, or role changes |
| `team` | Team creation, deletion, or repository permission changes |
| `repository` | Repository creation, deletion, archival, transfer, or visibility changes |
| `branch_protection_rule` | Branch protection rules created, edited, or deleted |
| `branch_protection_configuration` | Branch protection enabled or disabled |
| `repository_ruleset` | Repository or organization rulesets created, edited, or deleted |
| `deploy_key` | SSH deploy keys added or removed |

### Repository-Level Webhook (`--repo`)

Covers `member`, `repository`, `branch_protection_rule`, `branch_protection_configuration`, `repository_ruleset`, and `deploy_key`.

---

## Automated Configuration & Verification

Use [`scripts/ci/configure-security-webhooks.js`](../scripts/ci/configure-security-webhooks.js) to configure or verify webhooks via the GitHub REST API.

### 1. Preview configuration (`--dry-run`)

```bash
node scripts/ci/configure-security-webhooks.js \
  --org <github-org> \
  --url https://hooks.slack.com/services/XXX/YYY/ZZZ \
  --secret "<strong-random-hmac-secret>" \
  --dry-run
```

### 2. Create or update the organization webhook

Requires a GitHub token with `admin:org_hook` (for `--org`) or `admin:repo_hook` (for `--repo`):

```bash
GITHUB_TOKEN="<pat-with-admin-hook-scope>" \
node scripts/ci/configure-security-webhooks.js \
  --org <github-org> \
  --url https://hooks.slack.com/services/XXX/YYY/ZZZ \
  --secret "<strong-random-hmac-secret>"
```

### 3. Verify existing webhook coverage (`--check`)

```bash
GITHUB_TOKEN="<pat-with-admin-hook-scope>" \
node scripts/ci/configure-security-webhooks.js \
  --org <github-org> \
  --url https://hooks.slack.com/services/XXX/YYY/ZZZ \
  --check
```

Exits with `0` if an active webhook matches the target URL and subscribes to all required events, or `1` if missing/incomplete.

---

## Manual GitHub Organization UI Setup

1. Navigate to **Organization Settings → Webhooks → Add webhook**.
2. Set **Payload URL** to your HTTPS Slack, Discord, or SIEM ingestion endpoint.
3. Set **Content type** to `application/json`.
4. Set **Secret** to a high-entropy random string and configure your receiver to verify the `X-Hub-Signature-256` HMAC-SHA256 header.
5. Keep **Enable SSL verification** enabled (`insecure_ssl: "0"`).
6. Select **Let me select individual events** and check:
   - Branch protection configurations
   - Branch protection rules
   - Deploy keys
   - Collaborators (`member`)
   - Memberships (`membership`)
   - Organizations (`organization`)
   - Repositories (`repository`)
   - Repository rulesets (`repository_ruleset`)
   - Teams (`team`)
7. Ensure **Active** is checked and click **Add webhook**.

---

## Repository-Level GitHub Actions Fallback

In addition to organization webhooks, [`.github/workflows/security-audit-alerts.yml`](../.github/workflows/security-audit-alerts.yml) streams `branch_protection_rule` (`created`, `edited`, `deleted`) and `public` visibility events directly from GitHub Actions.

### Required Repository Secrets

| Secret | Required | Purpose |
|---|---|---|
| `SECURITY_AUDIT_WEBHOOK_URL` | Yes | HTTPS webhook URL for Slack, Discord, or SIEM |
| `SECURITY_AUDIT_WEBHOOK_SECRET` | Optional (recommended for SIEM) | HMAC-SHA256 secret sent as `X-Hub-Signature-256` |

### Testing Delivery

Trigger the **Security Audit Alerts** workflow manually via **Actions → Security Audit Alerts → Run workflow** (`workflow_dispatch`) to verify end-to-end delivery to your security channel.

---

## Incident Triage Checklist

When an unexpected administrative alert arrives:

1. **Verify the actor**: Confirm with the GitHub user listed in `actor` via an out-of-band channel whether the change was authorized.
2. **Revert unauthorized changes**: Immediately revoke unauthorized collaborators/deploy keys and restore branch protection rules (see [`docs/BRANCH_PROTECTION.md`](./BRANCH_PROTECTION.md)).
3. **Inspect recent commits & PRs**: Audit commits pushed or merged around the timestamp of the alert.
4. **Rotate credentials**: If an account or token was compromised, revoke active sessions/PATs and rotate affected repository secrets.
