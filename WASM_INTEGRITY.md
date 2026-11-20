# Soroban WASM integrity (W11-CAR-015, #1368)

## Current security boundary

The backend repository contains **no compiled contract WASM artifacts**. The previous
integrity workflow quietly passed with zero binaries and checked an optional
`.wasm-checksums` file. It also did not verify the ZK verifier. That is not an
acceptable deployment integrity check.

This change adds a **fail-closed** verifier for nine WASMs produced by the audited
`Pi-Defi-world/acbu-smart-contract` workspace, including `zk_verifier.wasm`.
The CI workflow checks out **an immutable upstream commit**, compiles the nine
binaries, and compares their SHA-256 values against an **independently approved**
`.wasm-checksums` file in this backend repository. Missing lock, missing binary,
wrong digest, reused digest, invalid WASM header, symlinked file, or unknown WASM
binary fails the job. A fresh build never automatically updates the approved lock.

The exact audited source revision is pinned in
`.github/workflows/verify-wasm-integrity.yml`. Toolchain: Rust 1.88.0,
`wasm32-unknown-unknown`, release profile, Cargo.lock (`cargo build --locked`).
Updating the source revision or build settings **requires a new reviewed lock**.

## Required approved artifacts

| Contract | Release WASM |
| --- | --- |
| ACBU burning | `acbu_burning.wasm` |
| ACBU escrow | `acbu_escrow.wasm` |
| ACBU lending pool | `acbu_lending_pool.wasm` |
| ACBU minting | `acbu_minting.wasm` |
| ACBU multisig | `acbu_multisig.wasm` |
| ACBU oracle | `acbu_oracle.wasm` |
| ACBU reserve tracker | `acbu_reserve_tracker.wasm` |
| ACBU savings vault | `acbu_savings_vault.wasm` |
| ZK verifier | `zk_verifier.wasm` |

**Important:** This backend does not currently contain trustworthy compiled
binaries or previously approved checksums for these nine outputs. Therefore no
real checksums can safely be committed yet. Do not copy the **token import**
SHA-256 (`soroban_token_contract.wasm`) into the nine release-artifact entries:
that hash belongs to a *different binary*. Do not create an empty or made-up lock;
the gate will intentionally fail until auditors approve the baseline.

## Establishing a real approved SHA-256 baseline

1. Run **Verify WASM Integrity** on GitHub Actions (or reproduce the pinned
   source build in a controlled environment). The workflow generates the
   `candidate-wasm-sha256` artifact from the actual compiled binaries, even if
   the final approval gate fails because the lock is not yet present.
2. Review the source commit, pinned dependencies, build toolchain, outputs and
   binary provenance. Independently reproduce the build where feasible and
   investigate any differences.
3. Commit the **reviewed** `wasm-candidates.sha256` as `.wasm-checksums` in the
   backend repository. The file must contain **exactly nine distinct entries**,
   one per filename above, in standard `sha256sum` format:

   ```text
   <64 lowercase hex digits>  acbu_burning.wasm
   ...
   <64 lowercase hex digits>  zk_verifier.wasm
   ```

   The example placeholders are explanatory only; the verification script
   rejects them. Lock changes require security review and should be paired
   with source-revision changes when upgrading a contract.
4. Rerun the workflow and require a green **Verify nine pinned contract WASMs**
   status before any dependent build or deployment.

Local check with compiled artifacts:

```bash
node --test tests/wasmIntegrity.test.js
node scripts/ci/verify-wasm-integrity.js --dir path/to/target/wasm32-unknown-unknown/release --print-candidates
node scripts/ci/verify-wasm-integrity.js --dir path/to/target/wasm32-unknown-unknown/release --lock .wasm-checksums
```

The main backend CI and staging deployment pipelines consume the reusable
workflow as a required dependency. Their integrity check **must not** be
suppressed with `|| true`, `continue-on-error`, or a "no WASM found" pass path.

## Deployment scope and separate source-repository controls

This gate covers the **backend's** CI and staging deployment decisions and the
nine approved binaries compiled from pinned source. It does not by itself
change `Pi-Defi-world/acbu-smart-contract`'s independent on-chain deployment
workflow. That repository's `deploy.yml` currently tolerates failure of
`verify_deployment.sh` (`|| true`); its maintainers must remove that bypass and
verify the same approved artifact digests **at the point of actual on-chain
submission**. A backend status check alone cannot prove that independently
submitted on-chain bytecode matches reviewed artifacts.