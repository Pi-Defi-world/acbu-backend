# Environment Promotion Pipeline Guide (Dev -> Staging -> Prod)

This document describes the multi-stage deployment and promotion pipeline for `acbu-backend`.

---

## 1. Promotion Pipeline Architecture

The environment promotion pipeline is implemented in `.github/workflows/env-promotion.yml`. It orchestrates promotions through three strict stages:

```
┌─────────────────────────────────┐
│ Stage 1: Pre-flight & Drift Gate│
│ - Static SQL guards             │
│ - Destructive migration checks  │
│ - Down-migration verification   │
│ - TypeScript compile check      │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│ Stage 2: Staging Deployment     │
│ - Apply migrations to Staging   │
│ - Deploy container to Staging   │
│ - Automated health check        │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│ Stage 3: Production Promotion   │
│ - Manual approval gate          │
│ - Rollback verification         │
│ - Apply migrations to Prod      │
│ - Deploy container to Prod      │
│ - Production canary smoke test  │
└─────────────────────────────────┘
```

---

## 2. Triggering Promotions

### Automated Staging Promotion
Every push to `main` (such as merged pull requests) automatically triggers:
1. Pre-flight & drift gate
2. Staging deployment & smoke tests

### Manual Production Promotion
Production deployments require explicit human review:
1. Navigate to **Actions** -> **Environment Promotion Pipeline**.
2. Click **Run workflow**.
3. Select `target_environment: production` (or `dev-to-staging-to-prod`).
4. Designate reviewers approve the deployment in GitHub Environment settings.
5. The pipeline executes the production release with health verification.
