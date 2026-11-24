# Snapshot Management Guide

## Overview

This document explains how to manage test snapshots in the `acbu_minting` contract to prevent stale snapshot data from causing false test passes.

## The Problem

Snapshot files (`test_snapshots/*.json`) capture the complete state of the Soroban test environment including:
- Ledger state with storage keys
- Contract events with field names
- Transaction details

When code is refactored:
- Variable names may change (e.g., `FEE_RATE` → `FEE_RATE_BPS`)
- Event types may be renamed (e.g., `mint` → `mint_acbu`)
- Storage keys may be removed or added

**If snapshots are not regenerated**, they contain old field names and the tests can pass with stale data, creating a false sense of security.

## The Solution

We implement a multi-layered approach:

### 1. Snapshot Validation Module

The `snapshot_validation.rs` module provides:
- **Schema validation**: Detects structural changes in snapshots
- **Field name validation**: Checks storage keys against expected values
- **Event validation**: Verifies event types match current implementation
- **Automated reports**: Clear guidance on what needs to be fixed

### 2. Expected Fields Registry

Update these constants in `snapshot_validation.rs` when refactoring:

```rust
const EXPECTED_STORAGE_KEYS: &[&str] = &[
    "ACBU_TKN",
    "ADMIN",
    "FEE_RATE",
    // ... add/remove/rename as needed
];

const EXPECTED_EVENT_TYPES: &[&str] = &[
    "mint",
    "set_admin",
    // ... add/remove/rename as needed
];
```

### 3. Snapshot Regeneration Workflow

#### Step 1: Identify Need for Regeneration

Run validation:
```bash
cargo test test_snapshot_validation --package acbu_minting -- --nocapture
```

If it fails, snapshots are stale.

#### Step 2: Clean Old Snapshots

```bash
rm -rf acbu_minting/test_snapshots/*.json
```

#### Step 3: Regenerate Snapshots

The Soroban SDK can regenerate snapshots automatically. Currently, snapshots appear to be generated but not actively used in tests. To properly integrate:

**Option A: Use soroban-sdk snapshot testing** (if available in your SDK version)
```rust
#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    
    // ... test code ...
    
    // Snapshot the environment state
    env.snapshot_check();  // This is SDK-specific
}
```

**Option B: Manual snapshot management**
If the SDK doesn't provide built-in snapshot testing, consider:
1. Using the snapshots for documentation purposes only
2. Implementing custom snapshot comparison logic
3. Migrating to a dedicated snapshot testing library like `insta`

#### Step 4: Update Expected Fields

If you renamed/added/removed storage keys or events:
```rust
// In snapshot_validation.rs
const EXPECTED_STORAGE_KEYS: &[&str] = &[
    "NEW_KEY_NAME",  // Added
    // "OLD_KEY_NAME",  // Removed
];
```

#### Step 5: Verify and Commit

```bash
# Run validation again
cargo test test_snapshot_validation --package acbu_minting

# Run all tests to ensure nothing broke
cargo test --package acbu_minting

# Commit new snapshots
git add acbu_minting/test_snapshots/*.json
git add acbu_minting/tests/snapshot_validation.rs
git commit -m "chore: regenerate test snapshots after refactoring"
```

## When to Regenerate Snapshots

Regenerate snapshots when:

- ✅ Storage keys are renamed, added, or removed
- ✅ Event types or event field names change
- ✅ Contract state structure changes
- ✅ After major refactoring
- ✅ When validation tests fail

Do NOT regenerate when:
- ❌ Only test logic changes (no contract changes)
- ❌ Documentation updates
- ❌ Unrelated contract changes

## Automation

### Pre-Commit Hook

Add snapshot validation to your pre-commit hook:

```bash
#!/bin/bash
# .githooks/pre-commit

echo "Validating snapshots..."
if ! cargo test test_snapshot_validation --package acbu_minting --quiet 2>&1 | grep -q "test result: ok"; then
    echo "❌ Snapshot validation failed!"
    echo "Run: cargo test test_snapshot_validation --package acbu_minting -- --nocapture"
    echo "to see details."
    exit 1
fi
```

### CI/CD Integration

Add to your GitHub Actions workflow:

```yaml
- name: Validate Snapshots
  run: |
    cargo test test_snapshot_validation --package acbu_minting -- --nocapture
```

## Best Practices

1. **Always validate before committing**
   ```bash
   cargo test test_snapshot_validation --package acbu_minting
   ```

2. **Document refactoring changes**
   - Update `EXPECTED_STORAGE_KEYS` and `EXPECTED_EVENT_TYPES`
   - Add migration notes in PR descriptions

3. **Review snapshot diffs carefully**
   - Snapshots are large JSON files
   - Use tools like `jq` to inspect changes:
     ```bash
     jq '.ledger.ledger_entries[].storage' test_snapshots/test_initialize.1.json
     ```

4. **Keep snapshots in version control**
   - Snapshots are part of the test suite
   - Changes should be reviewed in PRs

5. **Regenerate atomically**
   - Delete all snapshots before regenerating
   - Ensures consistency across all test cases

## Troubleshooting

### Validation fails with "Missing storage keys"
- You removed or renamed a storage key
- Update `EXPECTED_STORAGE_KEYS` in `snapshot_validation.rs`
- Regenerate snapshots

### Validation fails with "Unexpected storage keys"
- Old snapshots contain renamed/removed keys
- Regenerate snapshots to clean them up

### "No snapshots found" error
- Snapshots were deleted but not regenerated
- Run tests to generate new snapshots (if SDK supports it)
- Or restore from git: `git checkout -- acbu_minting/test_snapshots/`

### Snapshots exist but aren't used in tests
- Current test suite doesn't actively compare against snapshots
- Consider integrating snapshot testing properly or removing unused snapshots
- See "Snapshot Regeneration Workflow" Option A/B above

## Migration Path

If snapshots are not actively used in tests currently, consider:

1. **Remove unused snapshots**
   ```bash
   rm -rf acbu_minting/test_snapshots/
   ```

2. **Implement proper snapshot testing**
   Use a library like `insta`:
   ```toml
   [dev-dependencies]
   insta = { version = "1.34", features = ["json"] }
   ```

3. **Or document as reference material**
   Keep snapshots as documentation but don't enforce validation

## Related Files

- `acbu_minting/tests/snapshot_validation.rs` - Validation logic
- `acbu_minting/test_snapshots/*.json` - Snapshot files
- `acbu_minting/tests/test.rs` - Main test suite
- `.githooks/pre-commit` - Git hook for validation

## References

- [Soroban SDK Testing Documentation](https://soroban.stellar.org/docs/how-to-guides/testing)
- [Snapshot Testing Best Practices](https://jestjs.io/docs/snapshot-testing)
