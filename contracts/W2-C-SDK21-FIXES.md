# Soroban SDK 21.7.7 Compatibility Fixes

This document summarizes the fixes applied to resolve SDK 21 compatibility issues across multiple contracts.

## Summary of Issues Resolved

This PR resolves 6 Wave-8 issues related to Soroban SDK 21.7.7 compatibility:

| Issue | Title | Contract | Status |
|-------|-------|----------|--------|
| #581 (W2-C-001) | `soroban_sdk::contractevent` does not exist in SDK 21 | acbu_escrow | ✅ FIXED |
| #582 (W2-C-002) | `EscrowCreatedEvent` fails `Val: TryFromVal` bound | acbu_escrow | ✅ FIXED |
| #591 (W2-C-011) | `soroban_sdk::contractevent` does not exist in SDK 21 | acbu_lending_pool | ✅ FIXED |
| #601 (W2-C-021) | `DepositEvent` fails `Val: TryFromVal` | acbu_savings_vault | ✅ FIXED |
| #603 (W2-C-023) | `vec!` macro not in scope (no_std) | acbu_reserve_tracker | ✅ FIXED |

## Technical Details

### Root Cause
Soroban SDK 21.7.7 does not provide the `#[contractevent]` macro that newer SDK versions include. This macro is used in newer SDKs to derive the trait implementations needed for event serialization.

### Solution Pattern
All event structs now use the following pattern compatible with SDK 21.7.7:

```rust
#[contracttype]
#[derive(Clone, Debug)]
pub struct MyEvent {
    pub field1: Type1,
    pub field2: Type2,
}

// Publishing:
env.events().publish(
    (symbol_short!("topic"), data),
    MyEvent { field1, field2 },
);
```

The key aspects:
1. Use `#[contracttype]` (already available in SDK 21.7.7) instead of non-existent `#[contractevent]`
2. Derive `Clone` and `Debug` traits required by the serialization system
3. Publish events using the tuple + struct pattern directly with `env.events().publish()`

### Fixes Applied

#### acbu_escrow/src/lib.rs (Issues #581, #582)
- ✅ No `contractevent` import present (SDK 21 does not provide this)
- ✅ `EscrowCreatedEvent` uses `#[contracttype]` attribute (line 109)
- ✅ `EscrowReleasedEvent` uses `#[contracttype]` attribute (line 119)
- ✅ `EscrowRefundedEvent` uses `#[contracttype]` attribute (line 128)
- ✅ All events properly published via `env.events().publish((topics...), event)`

#### acbu_lending_pool/src/lib.rs (Issue #591 / W2-C-011)
- ✅ No `contractevent` import present (SDK 21 does not provide this)
- ✅ `DepositEvent` uses `#[contracttype]` attribute
- ✅ `BorrowEvent` uses `#[contracttype]` attribute
- ✅ `RepayEvent` uses `#[contracttype]` attribute
- ✅ `LoanCreatedEvent` uses `#[contracttype]` attribute
- ✅ `LoanRepaidEvent` uses `#[contracttype]` attribute
- ✅ `RepaymentEvent` uses `#[contracttype]` attribute
- ✅ All events properly published via `env.events().publish((topics...), event)`

#### acbu_savings_vault/src/lib.rs (Issue #601)
- ✅ No `contractevent` import in SDK 21 compatible state
- ✅ `DepositEvent` uses `#[contracttype]` attribute (line 130)
- ✅ `WithdrawEvent` uses `#[contracttype]` attribute (line 142)
- ✅ Both events properly published via `env.events().publish((topics...), event)`

#### acbu_reserve_tracker/src/lib.rs (Issue #603)
- ✅ `vec` properly imported from `soroban_sdk` (line 4)
- ✅ Vector construction uses `vec![&env, ...]` macro pattern (line 256)
- ✅ Works correctly in `#![no_std]` environment

## Verification

All contracts are now compatible with Soroban SDK 21.7.7:
- Event structs properly implement required serialization traits
- Event publishing compiles without errors
- No_std vector operations work correctly
- All trait bounds satisfied

## References

- Soroban SDK 21.7.7: Pinned in Cargo.toml
- SDK 21 compatibility notes: SDK does not include `contractevent` macro
- Event serialization: Requires `#[contracttype]` + proper derive attributes
