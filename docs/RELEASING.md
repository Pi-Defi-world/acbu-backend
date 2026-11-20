# Releasing & Changelog

## Overview

Changelog generation is automated via [`conventional-changelog-cli`](https://github.com/conventional-changelog/conventional-changelog) using the `conventionalcommits` preset. It reads commit messages following the [Conventional Commits](https://www.conventionalcommits.org/) specification and groups them by type.

The repository does **not** rewrite git history; the changelog is derived entirely from existing commits.

## Commit Conventions

Commits are expected to use the format:

```
<type>(<scope>): <subject>
```

Recognised `type` values and their changelog sections:

| Type       | Changelog Section | Meaning |
|------------|-------------------|---------|
| `feat`     | Features          | A new feature for the user |
| `fix`      | Bug Fixes         | A bug fix for the user |
| `docs`     | Documentation     | Documentation-only changes |
| `refactor` | Refactoring       | Code change that neither fixes a bug nor adds a feature |
| `test`     | Tests             | Adding or refactoring tests |
| `ci`       | CI/CD             | Changes to CI/CD configuration |
| `security` | Security          | Security-relevant fixes or hardening |
| `chore`    | Chores            | Build process, tooling, dependency bumps |
| `style`    | Styles            | Formatting, whitespace, lint-only changes |

Commits that are `BREAKING CHANGE` (either via footer or a `!` after the type/scope) are additionally highlighted at the top of each release section.

## Scripts

Two scripts are provided in `package.json`:

- **`pnpm changelog`** — Regenerate the **entire** `CHANGELOG.md` from scratch using all git history. Use this for the initial generation or whenever you want a fully clean re-render.

  ```bash
  pnpm changelog
  ```

- **`pnpm changelog:update`** — Append only **new, unreleased** commits on top of the existing `CHANGELOG.md`. Use this right after tagging a release to prepend the new release's section without touching older entries.

  ```bash
  pnpm changelog:update
  ```

Both invoke `conventional-changelog -p conventionalcommits -i CHANGELOG.md -s` with `-r 0` (full regen) or default `-r 1` (append latest).

## Release Workflow (when tags are used)

`conventional-changelog` only discovers tags that match the prefix it is given
(plain `vX.Y.Z` by default), so package-scoped tags need an explicit prefix:
`-t "backend@v"`, `-t "frontend@v"` and `-t "contracts@v"` (or `-l <name>` for
`name@X.Y.Z`-style tags). The `pnpm changelog` scripts pass no prefix, so they
only see legacy `vX.Y.Z` tags; a package-scoped release's generated notes may
therefore start from the last legacy tag until per-package scripts exist. The
recommended release flow:

1. Ensure you are on the release branch (`main` / `dev` / `develop` as applicable) with a clean working tree.
2. Bump the version of the package being released (`package.json` for the
   backend/frontend, `contracts/Cargo.toml` for the contracts).
3. Create and push an annotated, package-scoped git tag:

   ```bash
   git tag -a backend@v1.2.0 -m "backend v1.2.0"
   git push origin backend@v1.2.0
   ```

   Use `frontend@vX.Y.Z` or `contracts@vX.Y.Z` for the other packages. The
   release workflow rejects unknown packages and malformed versions; see
   [Multi-Package Releases](MULTI_PACKAGE_RELEASES.md) for details.

4. Update the changelog:

   ```bash
   pnpm changelog:update
   ```

   Or, to regenerate every section (useful after retconning older tag annotations):

   ```bash
   pnpm changelog
   ```

5. Commit the updated `CHANGELOG.md` and push.

## No Tags Yet

Until the first release tag is created, `pnpm changelog` produces a single `[1.0.0]` section (using the version from `package.json`) grouping all historical commits by type. This matches the current initial `CHANGELOG.md` in the repository.
