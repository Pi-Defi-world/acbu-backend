# W11-CAR-011: Backend Scope Assessment

## Finding

The reported `ReserveTrackerError` enum assigns discriminant `101` to both an
attestation-expired variant and a calculation-failed variant. This makes the
on-chain error code ambiguous to clients.

## Backend repository assessment

The `acbu-backend` repository does not contain the Rust contract source or a
`ReserveTrackerError` definition. The backend reserve service invokes the
contract, while its Soroban error wrapper preserves the returned error text;
it has no mapping that can distinguish the two variants sharing code `101`.

Consequently, a backend-only change cannot make the contract's encoded error
codes unique. Guessing which variant a duplicate code represents would risk
misreporting the failure rather than resolving the ambiguity.

## Required root remediation

In the repository containing the reserve tracker contract:

1. Assign every `ReserveTrackerError` variant a unique, non-overlapping
   sequential `u32` discriminant.
2. Add a contract test that checks all variant discriminants are unique and
   verifies the attestation-expired and calculation-failed codes separately.
3. Build and deploy the corrected contract before relying on clients to decode
   those errors unambiguously.

## Status

This report documents the backend repository boundary only. It does not change
runtime behavior or resolve the duplicate contract discriminant.
