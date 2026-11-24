# Contributing to ACBU Backend

Thank you for your interest in contributing! Please read this guide before opening issues or pull requests.

## Table of Contents

- [Getting Started](#getting-started)
- [Branch Naming](#branch-naming)
- [Commit Messages](#commit-messages)
- [Commit Signing (Required)](#commit-signing-required)
- [Testing Requirements](#testing-requirements)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)

---

## Getting Started

1. Fork the repository and clone your fork.
2. Install dependencies: `pnpm install`
3. Copy `.env.example` to `.env` and fill in the required values (see [ENV_VARS.md](ENV_VARS.md)).
4. Start required services: `docker-compose up -d rabbitmq`
5. Run migrations: `pnpm prisma:generate && pnpm prisma:migrate`
6. Verify everything works: `pnpm test && pnpm lint`

---

## Branch Naming

Use one of the following prefixes:

| Prefix | When to use |
|--------|-------------|
| `feat/` | New feature |
| `fix/` | Bug fix |
| `docs/` | Documentation only |
| `refactor/` | Code change that is neither a fix nor a feature |
| `test/` | Adding or updating tests |
| `chore/` | Build, CI, or dependency updates |

Examples: `feat/p2p-transfer`, `fix/kyc-validation`, `docs/contributing-guidelines`

---

## Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(optional scope): <short summary>

[optional body]

[optional footer — e.g. Closes #123]
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`

**Rules:**
- Summary in imperative mood, lowercase, no trailing period.
- Limit the subject line to 72 characters.
- Reference issues in the footer: `Closes #123` or `Fixes #123`.

Examples:
```
feat(transfer): add createTransfer with KYC validation

fix(auth): handle expired JWT refresh tokens

docs: add contributing guidelines

Closes #478
```

---

## Commit Signing (Required)

All commits in pull requests to `main`, `dev` or `develop` must carry a GPG or
SSH signature that GitHub reports as **Verified**. The author name and email in
a commit header are self-asserted; a verified signature is the proof of origin
required by the branch protection rule (W11-INC-008). Commits signed with an
unknown, untrusted or revoked key are treated the same as unsigned commits.

### GPG

```bash
# Generate a key and add its public key to GitHub → Settings → Keys and secrets → GPG keys
gpg --full-generate-key
gpg --list-secret-keys --keyid-format=long

git config --global user.signingkey <KEY_ID>
git config --global commit.gpgsign true
```

### SSH

```bash
# Generate a key and add its .pub file to GitHub → Settings → Keys and secrets → SSH keys
ssh-keygen -t ed25519 -C "you@example.com"

git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

### Verify locally

```bash
git commit -m "fix: example"
git log --show-signature -1
git verify-commit HEAD
```

The `Signed Commits / Verify signed commits` CI check lists every commit in the
PR and reports any commit that GitHub does not verify. Branch protection is the
blocking control once an admin enables **Require signed commits**. See
[BRANCH_PROTECTION.md](docs/BRANCH_PROTECTION.md#commit-signature-enforcement-w11-inc-008)
for the required repository setting, the admin audit command and how to promote
the CI report to a required check.

---

## Testing Requirements

- Every new feature or bug fix **must** include tests.
- Tests live in the `tests/` directory and mirror the `src/` structure.
- Run the full suite before opening a PR:

```bash
pnpm test
pnpm test:coverage  # optional but appreciated
```

- All tests must pass. PRs with failing tests will not be merged.
- Aim to keep coverage at or above the current project baseline.

---

## Pull Request Process

1. Push your branch and open a PR against `dev` (not `main`).
2. Fill in the PR template (summary, what was tested, any blocked items).
3. Keep the PR focused — one concern per PR.
4. Request a review from at least one maintainer.
5. For **destructive database migrations**, add the `allow-destructive-migration` label; the CI pipeline will block the merge otherwise.
6. A PR is merged only after:
   - CI passes (lint, tests, build, migration validation, verified commits)
   - At least one approving review

---

## Code Style

- TypeScript strict mode is enabled — no `any` unless absolutely necessary.
- Run `pnpm lint:fix` and `pnpm format` before committing.
- CI enforces both; PRs with lint or format errors will fail.
