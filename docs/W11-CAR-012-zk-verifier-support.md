# ZK verifier support and budget evidence

## Protocol 21 capabilities

All host-function statements in this document refer to Stellar Protocol 21.
Protocol 21 does not provide native Soroban host functions for BN254 pairings
or Poseidon hashing. A verifier that needs these operations must perform them
in contract code; the UltraHonk Soroban verifier uses the software verifier
crate rather than native pairing or Poseidon host primitives.

Do not describe BN254 pairing or Poseidon as native Soroban support when
planning verification workloads. Software-emulated cryptographic operations
consume contract CPU instructions and memory and can exceed the limits of an
on-chain invocation.

## Budget limits are not measurements

The backend budget guard documents configured ceilings of 100,000,000 CPU
instructions and 41,943,040 memory bytes in [WASM_INTEGRITY.md](../WASM_INTEGRITY.md).
These values are guard thresholds, not measured `verify_proof` consumption,
Protocol 21 guarantees, or evidence that a particular proof fits within the
network's invocation limits.

No exact `verify_proof` CPU or memory consumption is recorded in this backend
repository. Actual cost depends on the deployed verifier build, verification
key, proof, public inputs, and network protocol version. Do not publish a
specific cost without recording those inputs and measurement results.

## Measuring an invocation

Measure the exact verifier build and proof on a Soroban RPC endpoint running
Protocol 21. The verifier repository's
[`measure_ultrahonk_costs` utility](https://github.com/Pi-Defi-world/ultrahonk-soroban-verifier/tree/main/scripts/measure_ultrahonk_costs)
simulates `verify_proof` and reports CPU instructions, memory usage, and
minimum resource fees. From that repository, after building the circuit
artifacts and deploying the verifier with its verification key, run:

```bash
cd scripts/measure_ultrahonk_costs
npm install
npm run measure -- \
  --contract-id <CONTRACT_ID> \
  --source-secret <SECRET_KEY> \
  --rpc-url <PROTOCOL_21_SOROBAN_RPC_URL> \
  --dataset ../../tests/simple_circuit/target
```

Record the verifier WASM/build revision, network protocol version, verification
key and dataset alongside the reported costs. A result from a different
protocol version or proof is not a Protocol 21 measurement for the workload
under consideration.
