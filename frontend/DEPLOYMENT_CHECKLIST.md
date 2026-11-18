# ACBU Frontend — Deployment Checklist

> **Last updated:** 2026-06-30
> Reflects the actual project configuration: Next.js 16, pnpm, Node.js ≥ 20.

---

## 1. Prerequisites

- [ ] Node.js **20 or later** installed (matches `.nvmrc` and `.node-version`: `20`)
- [ ] **pnpm 10.15.0** installed (`npm install -g pnpm@10.15.0`)
- [ ] Access to the target hosting environment (see §7)
- [ ] All required environment variables available (see §3)

---

## 2. Local build verification

Run these steps on a clean checkout before triggering a production deploy.

```bash
# Install dependencies (uses pnpm-lock.yaml — do not use npm or yarn)
pnpm install --frozen-lockfile

# Type-check — TypeScript errors MUST fail the build (F-001 rule)
pnpm typecheck

# Lint
pnpm lint

# Build (generates PWA icons then runs `next build`)
pnpm build

# Unit tests
pnpm test

# E2E smoke tests (requires a running server on :3000)
pnpm test:e2e
```

Build output goes to `.next/`. Do **not** commit the `.next/` directory.

---

## 3. Environment variables

Copy `.env.example` to `.env.local` (local) or configure via your hosting
provider's secrets management before deploying.

### Client-side (bundled into the browser — **never put secrets here**)

| Variable | Required | Default / Example | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | **Yes** | `https://api.example.com/api/v1` | Backend API base URL |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | No | `https://horizon.stellar.org` | Stellar Horizon endpoint |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | No | *(empty)* | Soroban RPC endpoint |
| `NEXT_PUBLIC_ACBU_ASSET_CODE` | No | `ACBU` | On-chain asset code |
| `NEXT_PUBLIC_ACBU_ASSET_ISSUER` | No | *(empty)* | Stellar asset issuer address |
| `NEXT_PUBLIC_API_TIMEOUT` | No | `30000` | HTTP timeout in ms |
| `NEXT_PUBLIC_BILLS_ENABLED` | No | `false` | Feature-flag: enable bills UI |
| `NEXT_PUBLIC_SUPPORT_INTAKE_URL` | No | *(empty)* | Public support form URL |
| `NEXT_PUBLIC_DEMO_FIAT_ISSUER` | No | *(empty)* | Demo fiat issuer address |
| `NEXT_PUBLIC_DEBUG` | No | `false` | Verbose client logging |

> **Security guard:** `lib/env-safety.js` is called at build time via
> `next.config.mjs`. It throws if any `NEXT_PUBLIC_*` variable name contains
> dangerous patterns (`DATABASE_URL`, `JWT_SECRET`, `API_SECRET`,
> `PRIVATE_KEY`, `TOKEN`, `PASSWORD`). The build will **fail** before
> shipping secrets.

### Server-side only (never exposed to the browser)

| Variable | Required | Description |
|---|---|---|
| `SUPPORT_INTAKE_URL` | No | Internal endpoint used by `app/api/support/route.ts` to forward support requests. Leave empty to disable forwarding. |

---

## 4. CI / Quality gate

Two GitHub Actions workflows run automatically:

| Workflow | File | Triggers | What it checks |
|---|---|---|---|
| Frontend QA | `.github/workflows/frontend-qa.yml` | push / PR → `main`, `dev`, `develop` | typecheck, lint, build, unit tests, E2E smoke |
| Lighthouse CI | `.github/workflows/lighthouse-ci.yml` | push / PR → `dev` | FCP < 1.8 s, LCP < 2.5 s, TBT < 200 ms |

**All checks must pass before merging to `main`.**

Successful pushes to `dev` or `develop` deploy a Vercel preview to the
`staging` GitHub Environment. Successful pushes to `main` deploy to the
`production` GitHub Environment. Configure required reviewers and branch
restrictions for both environments in repository settings; production should
require an approval before deployment.

Add `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` as secrets in both
GitHub Environments. The staging job pulls Vercel's Preview variables and the
production job pulls Production variables, so configure each environment's
public API URL and other build-time values in Vercel.

---

## 5. Build flags

| Flag | How to use | Effect |
|---|---|---|
| `ANALYZE=true` | `ANALYZE=true pnpm build` | Opens bundle-analyzer report |
| `NODE_ENV=production` | Set by `next build` automatically | Disables dev-only code paths |

---

## 6. Database / migrations

This is a **frontend-only** repository. There are no database migrations here.
Data layer changes are handled by the backend API team.

---

## 7. Hosting

The project does not include a `vercel.json` and has no Vercel-specific
configuration in `next.config.mjs`. It can be deployed to any platform that
supports Next.js standalone or standard builds:

- **Self-hosted / Docker:** run `pnpm build` then `pnpm start` (`next start`)
- **Vercel:** push to `main`; set env vars in the Vercel dashboard
- **Other providers (Netlify, Render, Fly.io, etc.):** configure build
  command `pnpm build`, output directory `.next`, start command `pnpm start`

> **Note:** The `.gitignore` includes `.vercel/` to keep local Vercel CLI
> cache out of the repo. This does **not** mean Vercel is the required or
> only deployment target.

### Required server capabilities

- Node.js 20+
- Enough memory to run `next build` (~512 MB minimum, 1 GB recommended)
- Write access to the filesystem during build (for `.next/` output)

---

## 8. Post-deploy smoke test

After deploying, verify the following manually or via E2E:

- [ ] `/` loads without a JS console error
- [ ] Auth flow (sign-in → 2FA) works end-to-end
- [ ] Wallet balance displays correctly
- [ ] `NEXT_PUBLIC_API_BASE_URL` is pointing at the correct environment
- [ ] `Content-Security-Policy` header is present (set by `middleware.ts`)
- [ ] PWA icons load (`/icons/icon-192.png`, `/icons/icon-512.png`)

---

## 9. Rollback

1. Identify the last good commit SHA or deployment.
2. Re-deploy that commit / release via your hosting provider's rollback UI, or:
   ```bash
   git checkout <good-sha>
   pnpm install --frozen-lockfile
   pnpm build
   # then deploy the resulting .next/ directory
   ```
3. Verify with the §8 smoke test.

---

## 10. Secrets rotation

1. Update the secret value in your hosting provider's environment config.
2. Trigger a new deployment (server-side secrets take effect on next server
   start; client-side `NEXT_PUBLIC_*` values require a **rebuild**).
3. Confirm the old secret no longer works.
