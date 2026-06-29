# Changelog

All notable changes to this project will be documented in this file. See [docs/RELEASING.md](docs/RELEASING.md) for how to update this changelog.

## 1.0.0 (2026-06-29)

### Features

* Add engine-strict=true to .npmrc
* feat: Add schema validation for RabbitMQ messages with Zod
* feat: add renovate.json for automated dependency updates

### Bug Fixes

* fix
* resolve timezone confusion
* fix: resolve linting errors and clean up types
* fix: enable case-sensitive routing on Express app and router
* fix: remove stale .env.example entries and align S3 env vars with code
* fix: harden security headers and webhook body handling

### Chores

* chore(deps): update pnpm-lock.yaml to resolve overrides mismatch
* chore(deps): update pnpm-lock.yaml to resolve overrides mismatch
* chore(deps): add renovate.json for automated dependency updates

### Security

* security: remove sensitive architectural documents
* security: Block GraphQL endpoint and introspection attempts (#400)
