# zk_gate VK Rotation Requirements

This document defines the implementation requirements for issue #657. The
`zk_gate` contract source is not currently present in this checkout.

## Required behavior

- Store an owner when the contract is initialized.
- Store the active verification key (VK) during initialization.
- Expose a read-only operation for the active VK if the existing contract API
  supports read access.
- Expose an owner-only operation to replace the active VK.
- Require authorization from the stored owner before changing the VK.
- Reject calls from any non-owner and leave the stored VK unchanged.
- Reject an invalid or empty VK according to the proof verifier's format.
- Leave both owner and VK state unchanged when rotation fails.

## Required tests

- The owner can rotate the VK successfully.
- A non-owner cannot rotate the VK.
- An unauthorized rotation does not change the active VK.
- Invalid VK input is rejected without changing the active VK.

## Implementation prerequisite

The contract path `contracts/zk_gate/src/lib.rs` and its existing public API
must be restored or supplied before these requirements can be implemented
without inventing an incompatible proof-verification interface.