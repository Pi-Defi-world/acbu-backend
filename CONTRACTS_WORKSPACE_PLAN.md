# ZK Contracts Workspace Consolidation Plan

## Issue
The contracts/zk_verifier/Cargo.toml and contracts/zk_gate/Cargo.toml each pull soroban-sdk and ultrahonk_rust_verifier separately, creating a duplicated dependency graph with risk of version skew.

## Solution
Consolidate into a Cargo workspace to ensure single dependency resolution for both contracts.

## Implementation Plan

### 1. Create Workspace Structure
```toml
# [workspace]/Cargo.toml
[workspace]
members = [
    "zk_verifier",
    "zk_gate",
]
resolver = "2"

[workspace.dependencies]
soroban-sdk = "VERSION"
ultrahonk_rust_verifier = "VERSION"
```

### 2. Update Individual Contract Cargo.toml Files
```toml
# contracts/zk_verifier/Cargo.toml
[package]
name = "zk_verifier"
version = "0.1.0"
edition = "2021"

[dependencies]
soroban-sdk = { workspace = true }
ultrahonk_rust_verifier = { workspace = true }
```

```toml
# contracts/zk_gate/Cargo.toml
[package]
name = "zk_gate"
version = "0.1.0"
edition = "2021"

[dependencies]
soroban-sdk = { workspace = true }
ultrahonk_rust_verifier = { workspace = true }
```

## Benefits
- Single dependency resolution
- Eliminates version skew risk
- Reduced compilation time
- Consistent dependency versions across contracts
