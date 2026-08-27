# WASM Integrity Verification

The `.github/workflows/verify-wasm-integrity.yml` workflow detects tampered or unregistered
Soroban/Stellar smart contract WASM artifacts before they can reach a deployment environment.

## How it works

1. On every push or pull request that touches `contracts/`, `wasm/`, or `.wasm-checksums`,
   the workflow scans the repository for `*.wasm` files.
2. Each file's SHA-256 checksum is compared against the values recorded in `.wasm-checksums`.
3. The workflow fails if:
   - A WASM file's checksum does not match the recorded value (tampered artifact).
   - A WASM file exists but has no entry in `.wasm-checksums` (unregistered artifact).
4. The workflow warns (non-blocking) if `.wasm-checksums` contains entries for files that no
   longer exist (stale entries after a contract is removed).
5. If no `*.wasm` files are present (the current state of this repo), the workflow exits
   cleanly — no action is required until contracts are compiled and committed.

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

