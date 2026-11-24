# Test Suite Documentation

## Overview

This directory contains the test suite for the `acbu_minting` contract, including unit tests, integration tests, and snapshot validation.

## Test Structure

### Main Test Files

- **`test.rs`** - Core unit and integration tests
  - Initialization tests
  - Minting functionality (USDC, fiat, basket)
  - Fee calculation and validation
  - Admin operations
  - Upgrade path validation
  - Authorization checks

### Snapshot Management

- **`snapshot_validation.rs`** - Snapshot validation and management utilities
  - Validates snapshot freshness
  - Detects stale storage keys and event names
  - Provides regeneration utilities

## Running Tests

### Run All Tests
```bash
make test-minting
# or
cargo test --package acbu_minting
```

### Run Specific Test
```bash
cargo test test_initialize --package acbu_minting
```

### Run Snapshot Validation
```bash
make validate-snapshots
# or
cargo test test_snapshot_validation --package acbu_minting -- --nocapture
```

### Verbose Output
```bash
cargo test --package acbu_minting -- --nocapture
```

## Snapshot Testing

### What are Snapshots?

Snapshots capture the complete state of the Soroban test environment including:
- Ledger entries with contract storage
- Events emitted by the contract
- Transaction authorization details
- Contract instances and their state

### Why Snapshot Validation?

**Problem**: When code is refactored (variable names, event types, storage keys), old snapshots contain stale field names. Tests can pass with outdated data, creating false confidence.

**Solution**: Automated validation that checks:
1. Storage keys match current implementation
2. Event types are up-to-date
3. No unexpected fields exist (indicators of renames/removals)

### Snapshot Workflow

#### 1. Detect Stale Snapshots
```bash
make validate-snapshots
```

If validation fails, snapshots need regeneration.

#### 2. Update Expected Fields (if needed)

Edit `snapshot_validation.rs` to reflect your changes:

```rust
const EXPECTED_STORAGE_KEYS: &[&str] = &[
    "NEW_KEY",      // Added
    "RENAMED_KEY",  // Renamed from OLD_KEY
    // "OLD_KEY",   // Removed
];

const EXPECTED_EVENT_TYPES: &[&str] = &[
    "new_event",    // Added
    // "old_event", // Removed
];
```

#### 3. Regenerate Snapshots
```bash
make clean-snapshots  # Delete old snapshots
make test-minting     # Run tests (regenerates snapshots if SDK supports it)
```

#### 4. Validate and Commit
```bash
make validate-snapshots
git add acbu_minting/test_snapshots/*.json
git commit -m "chore: regenerate snapshots after refactoring"
```

### Pre-Commit Protection

The pre-commit hook automatically validates snapshots when you modify:
- Contract source (`acbu_minting/src/`)
- Tests (`acbu_minting/tests/`)
- Snapshots (`acbu_minting/test_snapshots/`)
- Shared libraries (`shared/src/`)

If validation fails, the commit is blocked until snapshots are regenerated.

### CI/CD Integration

GitHub Actions runs snapshot validation on:
- Pull requests modifying relevant files
- Pushes to `main` and `develop` branches

See `.github/workflows/validate-snapshots.yml`

## Test Categories

### Initialization Tests
- `test_initialize` - Basic initialization
- `test_initialize_twice` - Prevents double initialization
- `test_version_set_on_initialize` - Version tracking

### Minting Tests
- `test_mint_from_usdc` - Mint ACBU using USDC
- `test_mint_from_basket` - Mint from currency basket
- `test_mint_from_demo_fiat` - Mint from fiat (demo mode)
- `test_mint_insufficient_reserves` - Reserve validation
- `test_mint_from_usdc_exceeds_max` - Maximum mint limit
- `test_mint_from_demo_fiat_exceeds_max` - Maximum mint limit (fiat)

### Authorization Tests
- `test_mint_from_demo_fiat_wrong_operator` - Operator verification
- `test_set_operator_and_mint_demo_fiat` - Operator management

### Admin Operations Tests
- `test_update_oracle_by_admin` - Oracle address update
- `test_update_reserve_tracker_by_admin` - Reserve tracker update
- `test_update_acbu_token_by_admin_minting` - ACBU token update
- `test_update_vault_by_admin_minting` - Vault address update
- `test_update_treasury_by_admin` - Treasury address update
- `test_update_usdc_token_by_admin` - USDC token update

### Fee Validation Tests
- `test_set_fee_rate_accepts_in_range` - Valid fee rates
- `test_set_fee_rate_rejects_above_basis_points` - Fee limit (>100%)
- `test_set_fee_rate_rejects_negative` - Negative fee rejection
- `test_set_fee_single_rejects_above_basis_points` - Single fee limit

### Upgrade Tests
- `test_upgrade_rejects_same_version` - Prevents downgrades
- `test_upgrade_rejects_lower_version` - Version validation
- `test_storage_state_intact_across_upgrade_boundary` - State persistence

## Mock Contracts

Tests use mock implementations for external dependencies:

### `oracle_mock::MockOracle`
Provides fixed exchange rates and currency data for testing.

**Methods:**
- `get_acbu_usd_rate()` - Returns fixed ACBU/USD rate
- `get_currencies()` - Returns test currency list
- `get_basket_weight()` - Returns fixed basket weights
- `get_rate()` - Returns fixed currency rates
- `get_s_token_address()` - Returns synthetic token address

### `reserve_mock::MockReserveTracker`
Always returns `true` for reserve sufficiency checks.

### `failing_reserve_mock::MockFailingReserveTracker`
Always returns `false` for reserve sufficiency checks (tests failure cases).

## Writing New Tests

### Basic Test Template

```rust
#[test]
fn test_your_feature() {
    let env = Env::default();
    env.mock_all_auths();  // Mock authentication for testing
    
    // Setup test environment
    let (admin, oracle, reserve_tracker, acbu_token, usdc_token, client) = setup_test(&env);
    
    // Initialize contract
    init_mint_client(&env, &client, &admin, &oracle, &reserve_tracker,
        &acbu_token, &usdc_token, &admin, &admin, 300, 100);
    
    // Your test logic here
    let result = client.your_method(&param);
    
    // Assertions
    assert_eq!(result, expected_value);
}
```

### Failure Test Template

```rust
#[test]
#[should_panic(expected = "#5001")]  // Expected error code
fn test_your_failure_case() {
    let env = Env::default();
    env.mock_all_auths();
    
    // Setup that will cause failure
    // ...
    
    // This call should panic
    client.your_method(&invalid_param);
}
```

### Event Validation Template

```rust
#[test]
fn test_event_emission() {
    // ... setup and action ...
    
    let events = env.events().all();
    let mut found = false;
    
    for event in events.iter() {
        if event.0 != client.address {
            continue;
        }
        
        let topics = event.1;
        if !topics.is_empty() 
            && Symbol::from_val(&env, &topics.get(0).unwrap()) == symbol_short!("your_event") 
        {
            let event_data: YourEventType = event.2.into_val(&env);
            assert_eq!(event_data.field, expected_value);
            found = true;
            break;
        }
    }
    
    assert!(found, "expected your_event to be emitted");
}
```

## Best Practices

1. **Always mock authentication in tests**
   ```rust
   env.mock_all_auths();
   ```

2. **Use descriptive test names**
   - Good: `test_mint_from_usdc_exceeds_max_limit`
   - Bad: `test_mint_error`

3. **Test both success and failure cases**
   - Happy path tests
   - Edge cases
   - Error conditions

4. **Validate state changes**
   - Check balances
   - Verify storage updates
   - Confirm events emitted

5. **Keep tests isolated**
   - Each test should be independent
   - Use `setup_test()` for clean environment
   - Don't rely on test execution order

6. **Regenerate snapshots after refactoring**
   - Run `make validate-snapshots` before committing
   - Update `EXPECTED_STORAGE_KEYS` when storage changes
   - Regenerate with `make clean-snapshots && make test-minting`

## Troubleshooting

### Test Fails with "mock_all_auths not called"
**Solution**: Add `env.mock_all_auths();` at the start of your test

### Snapshot Validation Fails
**Solution**: See [Snapshot Management Guide](../SNAPSHOT_MANAGEMENT.md)

### "contract already initialized" Error
**Solution**: Ensure you're using a fresh `Env` instance for each test

### Event Not Found in Test
**Solution**: 
1. Check event is emitted in contract code
2. Verify event topic name matches
3. Use `-- --nocapture` to see event output

## References

- [Soroban Testing Documentation](https://soroban.stellar.org/docs/how-to-guides/testing)
- [Snapshot Management Guide](../SNAPSHOT_MANAGEMENT.md)
- [Main Contract Documentation](../README.md)
