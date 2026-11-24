# Setting Up Git Hooks

This project includes git hooks to enforce WASM integrity verification at commit time.

## Installation

Run this command once after cloning the repository:

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit
```

## Verification

To verify hooks are installed:

```bash
git config core.hooksPath
# Should output: .githooks
```

## What the Hooks Do

### pre-commit

Runs before each commit to:
1. Detect if WASM artifact is being modified
2. Verify all contract imports are updated with new hash
3. Ensure hash consistency across all three contracts
4. Prevent commits that would break the build

## Bypassing Hooks (Not Recommended)

If you need to bypass hooks for a specific commit:

```bash
git commit --no-verify
```

**Warning**: Only use this if you understand the security implications.

## Troubleshooting

### Hook not running

**Check if hooks are configured**:
```bash
git config core.hooksPath
```

**Reconfigure if needed**:
```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit
```

### Hook fails on WASM update

**If you intentionally updated the WASM**:
1. Get the new hash: `sha256sum soroban_token_contract.wasm`
2. Update all three contract imports
3. Update verification scripts
4. Try committing again

### Permission denied

**Make hook executable**:
```bash
chmod +x .githooks/pre-commit
```
