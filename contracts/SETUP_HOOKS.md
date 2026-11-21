# Git Hooks

The monorepo uses one root hook manager at `scripts/hooks/`. The backend,
frontend, and contracts workspaces all share it, so there is no separate
`contracts/.githooks` or `frontend/.husky` installation step.

## Installation

The root `postinstall` script configures the hooks automatically:

```bash
pnpm install
```

To configure them without reinstalling dependencies:

```bash
pnpm run hooks:install
# or
git config core.hooksPath scripts/hooks
chmod +x scripts/hooks/*
```

## Verification

```bash
git config core.hooksPath
# Should output: scripts/hooks
```

## What the Hooks Do

### pre-commit

Runs before each commit to:

1. Block accidental commits of `.env` and `.env.local`.
2. Lint and format staged backend TypeScript/JavaScript with the root ESLint and
   Prettier configuration.
3. Lint and format staged frontend files with the frontend's ESLint and Prettier
   configuration.
4. Scan staged files for secrets and credentials.
5. Verify contract WASM hashes and test snapshots when contract files change.

### commit-msg

Validates the commit message with the frontend's commitlint configuration when
the frontend dependencies are installed.

## Bypassing Hooks (Not Recommended)

If you need to bypass hooks for a specific commit:

```bash
git commit --no-verify
```

**Warning**: Only use this if you understand the security implications.

## Troubleshooting

### Hook not running

Check that the root hook path is configured:

```bash
git config core.hooksPath
```

Reconfigure it if needed:

```bash
pnpm run hooks:install
```

### Hook fails on WASM update

If you intentionally updated the WASM:

1. Get the new hash: `sha256sum contracts/soroban_token_contract.wasm`
2. Update all three contract imports.
3. Update verification scripts.
4. Try committing again.

### Permission denied

Make the hooks executable:

```bash
chmod +x scripts/hooks/*
```
