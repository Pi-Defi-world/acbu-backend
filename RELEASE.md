# Release Engineering & Versioning Guide

This document defines the formal release, versioning, and publishing process for `acbu-backend`.

---

## 1. Semantic Versioning Specification

`acbu-backend` follows [Semantic Versioning 2.0.0 (SemVer)](https://semver.org/):

```
v<MAJOR>.<MINOR>.<PATCH>[-<PRERELEASE>]
```

- **MAJOR**: Incompatible API changes, breaking database migrations, or breaking protocol alterations.
- **MINOR**: Backward-compatible new functionality, new endpoints, or non-breaking database columns.
- **PATCH**: Backward-compatible bug fixes, performance improvements, and security patches.
- **PRERELEASE** (optional): Release candidates (e.g., `v1.2.0-rc.1`) or beta builds for pre-production testing.

---

## 2. Release Artifact Pipeline

The automated release workflow is defined in `.github/workflows/release.yml`. Every release produces verifiable, auditable artifacts:

1. **Compiled Application Archive**: `acbu-backend-vX.Y.Z.tar.gz` containing:
   - Compiled JavaScript (`dist/`)
   - Schema and migration files (`prisma/`)
   - Package definitions (`package.json`, `pnpm-lock.yaml`)
   - Documentation and licenses (`README.md`, `CHANGELOG.md`)
2. **Cryptographic Checksums**: `SHA256SUMS` attached to every GitHub Release.
3. **OCI Container Image**: Built via Docker buildx and published to GitHub Container Registry (GHCR):
   - `ghcr.io/Pi-Defi-world/acbu-backend:vX.Y.Z`
   - `ghcr.io/Pi-Defi-world/acbu-backend:X.Y`
   - `ghcr.io/Pi-Defi-world/acbu-backend:latest`

---

## 3. Cutting a New Release (Maintainer Checklist)

To cut a new release from `main`:

### Step 1: Ensure CI and Migrations Are Green
- Verify all checks in `.github/workflows/ci.yml` pass.
- Verify schema drift check passes:
  ```bash
  pnpm run prisma:drift:check
  ```

### Step 2: Update CHANGELOG & Version
1. Generate changelog entries from conventional commits:
   ```bash
   pnpm run changelog:update
   ```
2. Bump the version in `package.json` to the target version (e.g. `1.1.0`):
   ```bash
   npm version 1.1.0 --no-git-tag-version
   ```
3. Review `CHANGELOG.md` to ensure highlights and breaking changes are noted.
4. Commit the release prep:
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore(release): prepare release v1.1.0"
   git push upstream main
   ```

### Step 3: Create and Push Git Tag
Create an annotated git tag prefixed with `v`:
```bash
git tag -a v1.1.0 -m "Release v1.1.0"
git push upstream v1.1.0
```

### Step 4: Verify Automated Pipeline
1. Navigate to **Actions** -> **Release & Artifact Publish**.
2. Confirm the workflow builds the bundle, pushes the GHCR image, and publishes the GitHub Release with attached `.tar.gz` and `SHA256SUMS`.

---

## 4. Rollback and Roll-Forward Procedure

If a release needs to be rolled back in staging or production:
1. Re-deploy the previous known-good tag:
   ```bash
   gh workflow run deploy-staging.yml -f ref=v1.0.0
   ```
2. If migrations were applied that need to be reverted, follow [Database Migration Rollback Runbook](docs/DB_MIGRATION_ROLLBACK.md) to execute the matching `down.sql`.
3. Cut a patch release (`v1.1.1`) containing the necessary fixes once resolved.
