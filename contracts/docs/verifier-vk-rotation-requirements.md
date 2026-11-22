# Verifier VK Rotation Requirements

This document defines the implementation requirements for issue #663. The
verifier contract source referenced by the issue is not currently present in
this checkout.

## Required behavior

- Store an owner during contract construction.
- Store the initial verification key (VK) during construction.
- Expose an owner-only operation to replace the active VK.
- Require authorization from the stored owner before changing the VK.
- Reject rotation attempts from any non-owner.
- Preserve the existing VK when an unauthorized or invalid rotation fails.
- Validate the replacement VK using the verifier's expected format before
  persisting it.

## Required tests

- Construction stores the configured owner and initial VK.
- The owner can rotate the VK successfully.
- A non-owner cannot rotate the VK.
- An unauthorized rotation leaves the active VK unchanged.
- Invalid VK input is rejected and leaves the active VK unchanged.

## Implementation prerequisite

The verifier contract `src/lib.rs`, its workspace registration, and its
existing verification API must be restored or supplied before these
requirements can be implemented without inventing an incompatible interface.