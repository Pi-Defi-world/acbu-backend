# Smart Contract Upgrade Runbook

This document outlines the procedures for safely upgrading smart contracts within the ACBU ecosystem using the unified versioning and migration framework.

## Overview

All contracts implement a standardized `upgrade` function and track their version using a shared `DataKey::Version`. The framework ensures:
- **Admin Authorization**: Only authorized administrators can trigger upgrades.
- **Sequential Migrations**: Migration logic runs sequentially from the current version to the target version.
- **Downgrade Prevention**: Upgrades to a lower or equal version are rejected to prevent state corruption.

## Upgrade Procedure

### 1. Deployment
Deploy the new WASM binary to the network to obtain its WASM hash.
```bash
soroban contract deploy --wasm path/to/new_contract.wasm --source admin_account
```

### 2. Preparation
Identify the target version number. This should be `current_version + 1` or higher if multiple versions are being skipped.

### 3. Execution
Invoke the `upgrade` function on the existing contract instance.
```bash
soroban contract invoke --id CONTRACT_ID --source admin_account -- \
  upgrade --new_wasm_hash <WASM_HASH> --new_version <NEW_VERSION>
```

### 4. Verification
Verify the upgrade by calling `get_version()` and checking the contract state.
```bash
soroban contract invoke --id CONTRACT_ID --source any_account -- get_version
```

## Migration Framework

When state changes are required across versions, implement the logic in the `migrate_vX_to_vY` helper functions within the contract.

### Pattern
```rust
pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>, new_version: u32) {
    // ... auth and version checks ...
    
    env.deployer().update_current_contract_wasm(new_wasm_hash);

    for v in current_version..new_version {
        match v {
            0 => migrate_v0_to_v1(env.clone()),
            1 => migrate_v1_to_v2(env.clone()),
            _ => {}
        }
    }

    env.storage().instance().set(&SharedDataKey::Version, &new_version);
}
```

### Rollback Strategy
- **Native Rollback**: Soroban does not support automatic state rollbacks. 
- **Recovery Upgrade**: If an upgrade fails or introduces bugs, deploy a "recovery" version with a higher version number that reverses the problematic state changes.
- **Backup**: Ensure off-chain indexers and data backups are up to date before performing upgrades.

## Safety Guidelines
- **No Data Loss**: Never remove storage keys during migration unless they are truly obsolete and replaced.
- **Backward Compatibility**: Ensure that old event formats or storage layouts are handled if the backend indexers require them.
- **Testnet Validation**: Always perform the full upgrade sequence on testnet before mainnet.
