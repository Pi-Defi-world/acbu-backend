# Multi-Package Releases

`acbu-backend` is the home of three independently versioned packages. Each one
is released with its own git tag, so a tag always says which package it ships
and never has to be guessed from context:

| Package     | Directory    | Release tag          | Example              |
| ----------- | ------------ | -------------------- | -------------------- |
| `backend`   | `.` (root)   | `backend@vX.Y.Z`     | `backend@v1.2.0`     |
| `frontend`  | `frontend/`  | `frontend@vX.Y.Z`    | `frontend@v2.1.0`    |
| `contracts` | `contracts/` | `contracts@vX.Y.Z`   | `contracts@v0.8.0`   |

The bare tag `vX.Y.Z` is still accepted for the backend so existing automation
and rollback runbooks keep working, but it is deprecated for new releases: it
does not state which package it contains.

> Why not Changesets? The root `package.json` is not yet a pnpm workspace and
> the `frontend/` and `contracts/` trees are still landing from the monorepo
> consolidation, so a Changesets release PR cannot version them safely today.
> Component-scoped tags give the same guarantee — one package, one version, one
> release — without restructuring the repository first. If the root becomes a
> workspace later, Changesets can be layered on top without changing the tag
> contract below.

## What a release run does

`.github/workflows/release.yml` resolves the tag with
`scripts/release/resolve-release.js` before doing any work. The resolver
rejects unknown packages, malformed semver, and tags such as `backend@1.2.0`
(the `v` prefix is required), and writes the package, version, artifact name,
changelog path, and image tags as workflow outputs.

Each package release produces:

| Output                | backend                                   | frontend                                | contracts                                  |
| --------------------- | ----------------------------------------- | --------------------------------------- | ------------------------------------------ |
| GitHub Release        | `backend v1.2.0`                          | `frontend v2.1.0`                       | `contracts v0.8.0`                         |
| Archive               | `acbu-backend-v1.2.0.tar.gz` (`dist/`, `prisma/`, lockfile) | `acbu-frontend-v2.1.0.tar.gz` (`.next/` build output, lockfile) | `acbu-contracts-v0.8.0.tar.gz` (compiled WASM) |
| Checksums             | `SHA256SUMS`                              | `SHA256SUMS`                            | `SHA256SUMS`                               |
| Container image       | yes, `ghcr.io/Pi-Defi-world/acbu-backend` | no                                      | no                                         |
| Release notes source  | `CHANGELOG.md`                            | `frontend/CHANGELOG.md`                 | `contracts/CHANGELOG.md`                   |

Release notes are extracted from the released package's changelog heading for
that version. When the section is missing, the release body falls back to a
minimal "automated release for commit …" note.

### Container image tags

The backend keeps the tags it has always published, so existing deployments do
not need to change:

```
ghcr.io/Pi-Defi-world/acbu-backend:v1.2.0
ghcr.io/Pi-Defi-world/acbu-backend:1.2.0
ghcr.io/Pi-Defi-world/acbu-backend:1.2
ghcr.io/Pi-Defi-world/acbu-backend:latest
```

Only the backend publishes a container image today. The release for the
frontend and contracts packages publishes archives instead.

## Cutting a release

1. Merge the release prep on the package's branch (`main` / `dev`):
   - add the version's section to the package's changelog
   - bump the package version (`package.json` for backend/frontend,
     `Cargo.toml` for contracts)
2. Create and push an **annotated** component tag:

   ```bash
   # Backend
   git tag -a backend@v1.2.0 -m "backend v1.2.0"
   git push origin backend@v1.2.0

   # Frontend
   git tag -a frontend@v2.1.0 -m "frontend v2.1.0"
   git push origin frontend@v2.1.0

   # Contracts
   git tag -a contracts@v0.8.0 -m "contracts v0.8.0"
   git push origin contracts@v0.8.0
   ```

3. Watch **Actions → Release & Artifact Publish**. The run scans for secrets,
   builds and packages the tagged package, publishes the backend container when
   applicable, and creates the package-specific GitHub Release.

### Synchronized releases

When several packages should ship the same version at the same commit, push one
component tag per package. Each gets its own release, artifact, and (for the
backend) image, all with the same version:

```bash
git tag -a backend@v1.3.0 -m "backend v1.3.0"
git tag -a frontend@v1.3.0 -m "frontend v1.3.0"
git push origin backend@v1.3.0 frontend@v1.3.0
```

Releases remain independent: a merged frontend fix can be tagged
`frontend@v2.1.1` without touching the backend version.

### Prereleases

Add a semver prerelease suffix. GitHub marks the release as a prerelease:

```bash
git tag -a backend@v1.3.0-rc.1 -m "backend v1.3.0-rc.1"
git push origin backend@v1.3.0-rc.1
```

### Manual runs

`workflow_dispatch` takes the same tag string:

```bash
gh workflow run release.yml -f tag=frontend@v2.1.0
```

Use `-f dry_run=true` to build and package the artifact without publishing the
container image or creating a GitHub Release.

## Validation and guardrails

- The resolver is unit-tested in `scripts/release/resolve-release.test.js`
  (`pnpm test:release`, also run by CI).
- A tag for a package whose tree is not in the repository fails early with an
  actionable error instead of publishing an empty artifact. For example,
  `frontend@v2.1.0` requires `frontend/package.json`, and `contracts@v0.8.0`
  requires `contracts/Cargo.toml` and at least one compiled `.wasm`.
- The frontend builds on Node 24 (its `engines` requirement); the backend builds
  on Node 22 (its `engines` requirement).

## Rollback

Rolling back one package does not roll back the others:

1. Re-deploy the previous known-good tag for that package, e.g.
   `gh workflow run deploy-staging.yml -f ref=backend@v1.1.9`.
2. If a backend migration must be reverted, follow
   [Database Migration Rollback](DB_MIGRATION_ROLLBACK.md).
3. Cut a patch release for the affected package (`backend@v1.1.10`) once the
   fix is merged.
