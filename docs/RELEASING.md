# Releasing

This document explains how to generate and update the changelog.

## Prerequisites

Ensure you have installed all dependencies:

```bash
pnpm install
```

## Generating Changelog

### Initial Generation

To generate the changelog for the first time from all existing git history:

```bash
pnpm run changelog
```

### Updating Changelog

To update the changelog with new commits since the last version:

```bash
pnpm run changelog:update
```

## Commit Convention

This project follows the [Conventional Commits](https://www.conventionalcommits.org/) specification.
