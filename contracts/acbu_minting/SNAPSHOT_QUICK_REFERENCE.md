# Snapshot Validation - Quick Reference

## 🚀 Quick Commands

```bash
# Validate snapshots
make validate-snapshots

# Clean snapshots before regeneration
make clean-snapshots

# Run all tests (regenerates snapshots if SDK supports it)
make test-minting

# View detailed validation output
cargo test test_snapshot_validation --package acbu_minting -- --nocapture
```

## 🔄 After Refactoring Contract

```bash
# 1. Update expected keys if you changed storage keys or events
vim acbu_minting/tests/snapshot_validation.rs
# Edit EXPECTED_STORAGE_KEYS or EXPECTED_EVENT_TYPES

# 2. Regenerate snapshots
make clean-snapshots
make test-minting

# 3. Validate
make validate-snapshots

# 4. Commit
git add acbu_minting/test_snapshots/*.json
git add acbu_minting/tests/snapshot_validation.rs  # if you updated expected keys
git commit -m "chore: regenerate snapshots after refactoring"
```

## ⚠️ When Validation Fails

```
❌ Error: "Missing storage keys: NEW_KEY"
```
**Fix**: You added a new storage key but snapshots are stale
```bash
make clean-snapshots && make test-minting
```

```
❌ Error: "Unexpected storage keys: OLD_KEY"
```
**Fix**: You removed/renamed a storage key but snapshots still reference it
```bash
make clean-snapshots && make test-minting
```

```
❌ Error: "Snapshot validation failed"
```
**Fix**: Check detailed output and regenerate
```bash
cargo test test_snapshot_validation --package acbu_minting -- --nocapture
make clean-snapshots && make test-minting
```

## 📝 Update Checklist

When modifying contract code:

- [ ] Changed storage keys? → Update `EXPECTED_STORAGE_KEYS`
- [ ] Changed event types? → Update `EXPECTED_EVENT_TYPES`
- [ ] Run `make validate-snapshots`
- [ ] If validation fails → Regenerate with `make clean-snapshots && make test-minting`
- [ ] Commit both code and snapshot changes together

## 🛡️ Protection Layers

1. **Pre-commit hook** - Runs automatically when you commit snapshot-related changes
2. **CI/CD workflow** - Runs on PRs and pushes to main/develop
3. **Manual validation** - Run `make validate-snapshots` anytime

## 📚 Full Documentation

- **Detailed Guide**: [SNAPSHOT_MANAGEMENT.md](./SNAPSHOT_MANAGEMENT.md)
- **Test Documentation**: [tests/README.md](./tests/README.md)
- **Implementation Details**: [SNAPSHOT_IMPLEMENTATION_SUMMARY.md](./SNAPSHOT_IMPLEMENTATION_SUMMARY.md)

## 🔧 Expected Keys Location

Edit these in `acbu_minting/tests/snapshot_validation.rs`:

```rust
const EXPECTED_STORAGE_KEYS: &[&str] = &[
    "ACBU_TKN",
    "ADMIN",
    "FEE_RATE",
    // ... add your keys here
];

const EXPECTED_EVENT_TYPES: &[&str] = &[
    "mint",
    "set_admin",
    // ... add your events here
];
```

## 💡 Pro Tips

- **Always validate before committing**: `make validate-snapshots`
- **Regenerate atomically**: Delete all snapshots before regenerating (don't regenerate individually)
- **Review snapshot diffs**: Use `git diff` to review what changed in snapshots
- **Keep documentation updated**: Update expected keys when contract changes
- **Test the pre-commit hook**: Verify it catches issues before they reach CI

## 🆘 Emergency: Disable Validation Temporarily

If you need to commit urgently and validation is blocking you:

```bash
# Skip pre-commit hook (use with caution!)
git commit --no-verify -m "your message"
```

**Note**: This bypasses validation. Fix snapshots ASAP after committing.

## 📊 Validation Output Example

```
=== Snapshot Validation Report ===
✓ All snapshots are valid

# OR if there are issues:

=== Snapshot Validation Report ===
✗ Snapshot validation failed

Missing storage keys:
  - NEW_FEATURE_KEY

Unexpected storage keys (possibly renamed/removed):
  - OLD_DEPRECATED_KEY

Errors:
  - Snapshot test_initialize.1.json is invalid
```

## 🎯 Common Workflows

### Workflow: Adding New Storage Key

```bash
# 1. Add key to contract (lib.rs)
# 2. Add to validation
vim acbu_minting/tests/snapshot_validation.rs
# Add "NEW_KEY" to EXPECTED_STORAGE_KEYS

# 3. Regenerate
make clean-snapshots && make test-minting

# 4. Validate
make validate-snapshots

# 5. Commit
git add -A && git commit -m "feat: add new storage key"
```

### Workflow: Renaming Storage Key

```bash
# 1. Rename in contract (OLD_KEY → NEW_KEY)
# 2. Update validation
vim acbu_minting/tests/snapshot_validation.rs
# Replace "OLD_KEY" with "NEW_KEY" in EXPECTED_STORAGE_KEYS

# 3. Regenerate
make clean-snapshots && make test-minting

# 4. Validate
make validate-snapshots

# 5. Commit
git add -A && git commit -m "refactor: rename storage key"
```

### Workflow: Removing Storage Key

```bash
# 1. Remove from contract
# 2. Remove from validation
vim acbu_minting/tests/snapshot_validation.rs
# Remove "DEPRECATED_KEY" from EXPECTED_STORAGE_KEYS

# 3. Regenerate
make clean-snapshots && make test-minting

# 4. Validate
make validate-snapshots

# 5. Commit
git add -A && git commit -m "refactor: remove deprecated storage key"
```

---

**Remember**: Stale snapshots = False confidence. Always validate! 🎯
