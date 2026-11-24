# ZK Architecture

This document describes the zero-knowledge proof architecture used in the ACBU
protocol. Resolves **AZ-034** — correcting prior misleading claims about native
crypto support and Stellar protocol versions.

---

## Overview

ACBU uses **Noir** circuits to prove KYC compliance constraints off-chain. The
resulting proof is submitted to a Soroban smart contract (`zk_verifier`) that
runs a **pure-WASM Rust** verifier — there is no native Stellar precompile
involved.

```
┌──────────────────────────────────────────────────────┐
│                     Off-chain (client)               │
│                                                      │
│   Noir circuit  ──compile──►  ACIR / R1CS            │
│   (kyc_verifier, zk_comply_circuit)                  │
│                                                      │
│   Barretenberg (bb) backend                          │
│   ├─ prove(witness)  ──►  UltraHonk proof π          │
│   └─ write_vk()      ──►  verification key VK        │
└──────────────────────────────────────────────────────┘
                         │  π + public inputs
                         ▼
┌──────────────────────────────────────────────────────┐
│                  On-chain (Soroban WASM)              │
│                                                      │
│   zk_verifier contract                               │
│   └─ verify(π, public_inputs, VK)                    │
│       implemented in pure-WASM Rust                  │
│       (ultrahonk_rust_verifier crate)                │
└──────────────────────────────────────────────────────┘
```

---

## Cryptographic primitives

| Primitive       | Role                                     | Where it runs                         |
|-----------------|------------------------------------------|---------------------------------------|
| **BN254**       | Noir's default scalar field / proof system curve | Noir compiler, Barretenberg (off-chain); WASM verifier (on-chain) |
| **Poseidon2**   | ZK-friendly hash (commitment, nullifier) | Noir circuit (off-chain); replicated in pure-WASM Rust for on-chain checks |
| **UltraHonk**  | PLONK-based proof system                 | Barretenberg (off-chain prove); `ultrahonk_rust_verifier` WASM (on-chain verify) |

### Important: no Stellar/Soroban precompile

Soroban does **not** provide any native precompile or protocol-level
acceleration for BN254 elliptic curve operations or Poseidon2 hashing.
There is no such feature in any Stellar protocol version (25, 26, or later).

All cryptographic work happens either:
- **Off-chain** via the Barretenberg (`bb`) CLI / `@aztec/bb.js` WASM, or
- **On-chain** via the `zk_verifier` Soroban contract, which executes a
  pure-WASM Rust implementation compiled to `wasm32-unknown-unknown`.

Do not infer special on-chain guarantees from the terms "BN254" or
"Poseidon2" — they name the algorithm, not a hardware or protocol
acceleration path.

---

## Toolchain pinning

| Tool                        | Pinned version    | Enforced by                                  |
|-----------------------------|-------------------|----------------------------------------------|
| Noir (`nargo`)              | `1.0.0-beta.9`    | `compiler_version` in `Nargo.toml`           |
| Barretenberg (`bb`)         | `v0.87.0`         | `contracts/zk_verifier/README.md`            |
| `@aztec/bb.js`              | `0.87.0`          | `frontend/zk-comply-frontend/package.json`   |
| `@noir-lang/*` packages     | `1.0.0-beta.9`    | `frontend/zk-comply-frontend/package.json`   |

UltraHonk proof and VK serialization formats changed between Noir beta versions.
Artifacts built with a mismatched toolchain will **not** verify on-chain even if
the circuit source is unchanged. Always upgrade the entire toolchain atomically.

---

## Proof lifecycle

```
1. Client generates witness (private KYC data + public inputs)
2. Client calls `bb prove -b circuit.json -w witness.gz -o proof.bin`
3. Client submits proof.bin + public_inputs[] to zk_verifier.verify(…)
4. zk_verifier (WASM Rust) re-derives VK hash from stored VK, runs
   UltraHonk verifier, returns bool
5. Calling contract (e.g. acbu_minting) gates the transaction on the result
```

---

## Security properties

| Property                | Guarantee                                                        |
|-------------------------|------------------------------------------------------------------|
| Soundness               | An invalid proof cannot pass verification (Barretenberg security)|
| Zero-knowledge          | Private inputs (kyc_score, salt) are not revealed on-chain       |
| Caller binding (AZ-032) | `wallet_address_hash` public input ties the proof to one wallet  |
| Nullifier (AZ-032)      | `nullifier = poseidon2(commitment, salt)` prevents proof replay  |
| VK rotation             | Admin can rotate the verification key via multisig timelock      |

---

## Stellar protocol compatibility

The `zk_verifier` contract is a standard Soroban contract compiled to
`wasm32-unknown-unknown`. It is compatible with any Stellar protocol version
that supports Soroban (Protocol 20+). No specific protocol version is required
for BN254 or Poseidon2 operations — those run entirely inside the WASM sandbox.
