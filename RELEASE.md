# Release Engineering & Versioning Guide

This document defines the formal release, versioning, and publishing process for `acbu-backend`.

---

## 1. Semantic Versioning Specification

Each package in the repository is versioned independently and follows
[Semantic Versioning 2.0.0 (SemVer)](https://semver.org/):

```
<package>@v<MAJOR>.<MINOR>.<PATCH>[-<PRERELEASE>]
```

| Package     | Directory    | Tag example          |
| ----------- | ------------ | -------------------- |
| `backend`   | `.` (root)   | `backend@v1.2.0`     |
| `frontend`  | `frontend/`  | `frontend@v2.1.0`    |
| `contracts` | `contracts/` | `contracts@v0.8.0`   |

The bare `v<MAJOR>.<MINOR>.<PATCH>` form is still accepted as a backend
release for backwards compatibility, but new releases must name the package.
See [Multi-Package Releases](docs/MULTI_PACKAGE_RELEASES.md) for the full
tagging scheme and the release/rollback process.

- **MAJOR**: Incompatible API changes, breaking database migrations, or breaking protocol alterations.
- **MINOR**: Backward-compatible new functionality, new endpoints, or non-breaking database columns.
- **PATCH**: Backward-compatible bug fixes, performance improvements, and security patches.
- **PRERELEASE** (optional): Release candidates (e.g., `v1.2.0-rc.1`) or beta builds for pre-production testing.

---

## 2. Release Artifact Pipeline

The automated release workflow is defined in `.github/workflows/release.yml`.
It resolves the package from the tag before building, so a run never publishes
the wrong component. Every release produces verifiable, auditable artifacts:

1. **Package Archive**, named after the released package:
   - `acbu-backend-vX.Y.Z.tar.gz`: compiled JavaScript (`dist/`), schema and
     migrations (`prisma/`), `package.json`, `pnpm-lock.yaml`, `README.md`,
     `CHANGELOG.md`
   - `acbu-frontend-vX.Y.Z.tar.gz`: the Next.js build output (`.next/`) plus
     `package.json` and `pnpm-lock.yaml`
   - `acbu-contracts-vX.Y.Z.tar.gz`: the compiled Soroban WASM and `Cargo.toml`
2. **Cryptographic Checksums**: `SHA256SUMS` attached to every GitHub Release.
3. **OCI Container Image** (backend releases only): built via Docker buildx and
   published to GitHub Container Registry (GHCR):
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
2. Bump the version of the package being released (e.g. `1.1.0` for the
   backend):
   ```bash
   npm version 1.1.0 --no-git-tag-version
   ```
   For `frontend/` and `contracts/`, bump `frontend/package.json` or the
   `contracts/Cargo.toml` workspace version instead.
3. Review that package's changelog (`CHANGELOG.md`,
   `frontend/CHANGELOG.md`, or `contracts/CHANGELOG.md`) to ensure highlights
   and breaking changes are noted.
4. Commit the release prep:
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore(release): prepare backend v1.1.0"
   git push upstream main
   ```

### Step 3: Create and Push Git Tag
Create an annotated tag that names the package:
```bash
git tag -a backend@v1.1.0 -m "backend v1.1.0"
git push upstream backend@v1.1.0
```
Use `frontend@vX.Y.Z` or `contracts@vX.Y.Z` for those packages. To ship the
same version across packages, push one tag per package at the same commit.

### Step 4: Verify Automated Pipeline
1. Navigate to **Actions** -> **Release & Artifact Publish**.
2. Confirm the workflow builds the bundle, pushes the GHCR image, and publishes the GitHub Release with attached `.tar.gz` and `SHA256SUMS`.

---

## 4. Rollback and Roll-Forward Procedure

If a release needs to be rolled back in staging or production:
1. Re-deploy the previous known-good tag for the affected package:
   ```bash
   gh workflow run deploy-staging.yml -f ref=backend@v1.0.0
   ```
2. If migrations were applied that need to be reverted, follow [Database Migration Rollback Runbook](docs/DB_MIGRATION_ROLLBACK.md) to execute the matching `down.sql`.
3. Cut a patch release for the affected package (e.g. `backend@v1.1.1`) containing the necessary fixes once resolved.
