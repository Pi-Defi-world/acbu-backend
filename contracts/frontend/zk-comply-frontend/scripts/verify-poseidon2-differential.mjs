#!/usr/bin/env node
/**
 * W11-CAR-002 - end-to-end Poseidon2 differential check.
 *
 * The ZK-Comply circuit must hash with the canonical Barretenberg Poseidon2
 * sponge, because commitments and nullifiers are computed off-chain with
 * `@aztec/bb.js` and then checked inside the circuit. This script runs both
 * sides of that link and fails if they disagree:
 *
 *   1. barretenberg (`@aztec/bb.js`) hashes the vectors below;
 *   2. `nargo test` runs the circuit, whose `poseidon2_hash_matches_bb_js`
 *      test asserts the same digests.
 *
 * Both sides are compared against the same expected values, so a change to
 * either implementation (round constants, IV, absorb order) is caught here.
 *
 * Usage: npm run test:poseidon2  (set NARGO=/path/to/nargo if not on PATH)
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BarretenbergSync, Fr } from "@aztec/bb.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const circuitDir = path.resolve(here, "../../../circuits/zk_comply_circuit");

// Digests from the canonical sponge (rate 3, capacity 1, IV = len << 64).
// `poseidon2_hash_matches_bb_js` in the circuit asserts these same values.
const vectors = [
  {
    input: [1n, 566n],
    expected: "0x187f528fb9a32a987d16044b249b2eadc5ed916b50b5371b59cc3e9e8b688726",
  },
  {
    input: [1n, 566n, 12345n, 0n],
    expected: "0x208a72dec0df0224f59fdf62644c391524b9a313a49f62c90f0a20df1c84a391",
  },
  {
    input: [1n, 2n, 3n, 4n, 5n],
    expected: "0x2247be7014a54d17342a7ef677f58d28877780d203860396967f5d0a18d259db",
  },
  {
    input: [0n, 0n, 0n, 0n],
    expected: "0x20be000d93b852c82d4e02c94e9e61fa3a0e79949aac3af4010620651d416134",
  },
];

const bb = await BarretenbergSync.initSingleton();
let ok = true;

for (const { input, expected } of vectors) {
  const actual = bb.poseidon2Hash(input.map((value) => new Fr(value))).toString();
  if (actual !== expected) {
    ok = false;
    console.error(`bb.js mismatch for [${input.join(", ")}]:`);
    console.error(`  expected ${expected}`);
    console.error(`  actual   ${actual}`);
  }
}

if (!ok) {
  process.exit(1);
}

const nargo = process.env.NARGO ?? "nargo";
const result = spawnSync(nargo, ["test"], { cwd: circuitDir, encoding: "utf8" });

if (result.error) {
  console.error(
    `Could not run \`${nargo} test\` in ${circuitDir}: ${result.error.message}\n` +
      "Install Nargo 1.0.0-beta.9 (see contracts/zk/README.md) or set NARGO=.",
  );
  process.exit(1);
}

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);

// Nargo colorizes its test output; strip ANSI escapes before matching.
const plain = `${result.stdout}${result.stderr}`.replace(/\u001b\[[0-9;]*m/g, "");
if (result.status !== 0 || !/poseidon2_hash_matches_bb_js \.\.\. ok/.test(plain)) {
  console.error("Circuit Poseidon2 differential test did not pass.");
  process.exit(1);
}

console.log(`\nPoseidon2 differential check passed: bb.js and the circuit agree on ${vectors.length} vectors.`);
