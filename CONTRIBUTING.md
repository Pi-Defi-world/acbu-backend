# Contributing to ACBU Backend

Thank you for your interest in contributing! Please read this guide before opening issues or pull requests.

## Table of Contents

- [Getting Started](#getting-started)
- [Branch Naming](#branch-naming)
- [Commit Messages](#commit-messages)
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
   - CI passes (lint, tests, build, migration validation)
   - At least one approving review

---

## Code Style

- TypeScript strict mode is enabled — no `any` unless absolutely necessary.
- Run `pnpm lint:fix` and `pnpm format` before committing.
- CI enforces both; PRs with lint or format errors will fail.

## Database access

Always import the shared Prisma singleton — never instantiate `PrismaClient` directly:

```typescript
// ✅ correct
import { prisma } from "../../config/database";

// ❌ banned — triggers lint error (W11-CAR-026)
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
```

Standalone instances bypass connection pooling, the P2024 retry logic, and OpenTelemetry query
tracing. The `no-restricted-syntax` ESLint rule enforces this at lint time.
See [docs/W11-CAR-026-prisma-singleton.md](docs/W11-CAR-026-prisma-singleton.md) for details.
