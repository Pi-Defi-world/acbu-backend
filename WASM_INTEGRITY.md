# WASM Integrity Verification

The `.github/workflows/verify-wasm-integrity.yml` workflow checks SHA-256 checksums for
Soroban/Stellar WASM artifacts present in this repository. It validates existing binaries;
it does not compile contract source code.

## How it works

The workflow runs on pushes and pull requests targeting `main`, `dev`, or `develop` when
`contracts/**`, `wasm/**`, `.wasm-checksums`, or the workflow itself changes. It can also
be started manually with `workflow_dispatch`.

The job scans the checkout for `*.wasm` files, then:

1. Runs `sha256sum --check .wasm-checksums` to fail on missing or mismatched recorded
   checksums.
2. Checks that each discovered WASM path is registered in `.wasm-checksums`.
3. Emits a warning for checksum entries that refer to files that no longer exist.
4. If there are no WASM files, skips checksum verification successfully.

The workflow does not build Rust crates or produce WASM artifacts.

## Contract build verification scope

The integrity workflow in this backend repository is an artifact checksum check, not a
contract build matrix. The backend checkout does not contain a Rust workspace or contract
crate manifests; its Soroban contract references are diagnostic strings in
`src/services/stellar/sorobanInvokeErrors.ts`. Consequently, this workflow cannot compile
the contract workspace from this checkout.

Issue `Pi-Defi-world/acbu-backend#1380` requests compiling and verifying all nine contracts,
including the additional `savings_vault`, `lending_pool`, `escrow`, and `multisig` contracts.
Implementing that build-matrix check requires running it in, or explicitly checking out,
the repository that contains the contract workspace. Adding those build targets to this
backend workflow without that source workspace would not verify the contracts and could
make CI fail.

## Registering a new WASM artifact

After compiling a Soroban contract, add its checksum to `.wasm-checksums`:

```bash
# From the repository root
sha256sum path/to/contract.wasm >> .wasm-checksums

# Or regenerate the full file for all WASM artifacts at once
find . -name "*.wasm" \
  -not -path "./.git/*" \
  -not -path "./node_modules/*" \
  | xargs sha256sum > .wasm-checksums
```

Commit both the `.wasm` file and the updated `.wasm-checksums` in the same PR.

## Updating a checksum after a legitimate contract upgrade

Rebuilding a contract produces a new binary with a different checksum. To update:

```bash
# Recompute the checksum for the specific file
sha256sum path/to/contract.wasm

# Replace the old entry in .wasm-checksums, then regenerate if needed
find . -name "*.wasm" \
  -not -path "./.git/*" \
  -not -path "./node_modules/*" \
  | xargs sha256sum > .wasm-checksums
```

Commit the updated `.wasm-checksums` alongside the new `.wasm` file. The PR must include
both; a checksum-only update without the corresponding binary (or vice versa) will fail
the workflow.

## Removing a contract

Delete the `.wasm` file and remove its line from `.wasm-checksums`. The workflow will warn
about stale entries to catch cases where the file was deleted but the checksum was not cleaned up.

## Soroban contract references in this backend

The backend currently references WASM in error-message strings only
(`src/services/stellar/sorobanInvokeErrors.ts`). These are diagnostic hints about which
contract binary to rebuild when a Soroban invocation fails — they are not compiled artifacts.

When compiled contract binaries are added to this repository, place them under `contracts/`
or `wasm/` and follow the registration steps above.

## Soroban Contract Performance & Budget Guard

The `.github/workflows/soroban-contract-benchmarks.yml` workflow and `scripts/ci/check-contract-budget.js` script enforce budget ceilings and measure performance for Soroban smart contracts (`acbu-smart-contract`, `ultrahonk-soroban-verifier`, and local WASM binaries):

- **Max WASM Binary Size**: 256 KB (262,144 bytes)
- **Max CPU Instructions**: 100,000,000 instructions per contract invocation
- **Max Memory Bytes**: 40 MB (41,943,040 bytes)
- **Max Storage Read/Write**: 1 MB (1,048,576 bytes)

### Running Budget Checks Locally

```bash
# Scan default contract directories
node scripts/ci/check-contract-budget.js

# Custom budget limits via environment variables
MAX_WASM_SIZE_KB=300 MAX_CPU_INSTRUCTIONS=120000000 node scripts/ci/check-contract-budget.js --dir contracts
```

## Workflow files

- Integrity Guard: `.github/workflows/verify-wasm-integrity.yml`
- Performance & Budget Guard: `.github/workflows/soroban-contract-benchmarks.yml`

