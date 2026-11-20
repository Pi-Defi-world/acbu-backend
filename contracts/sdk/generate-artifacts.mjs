/**
 * Generate proof artifacts for ZK-Comply.
 * 
 * Compiles the Noir circuit, generates a witness, proves it
 * with UltraHonk, and outputs vk + proof + public_inputs files.
 * 
 * Built with the shared pinned toolchain (Noir 1.0.0-beta.9 +
 * Barretenberg v0.87.0) so the artifacts verify on-chain (AZ-011).
 * 
 * Usage: node generate-artifacts.mjs
 * Output: .zk-comply-proof/proof, .zk-comply-proof/vk, .zk-comply-proof/public_inputs
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { compile, createFileManager } from "@noir-lang/noir_wasm";
import { Noir } from "@noir-lang/noir_js";
import { UltraHonkBackend } from "@aztec/bb.js";
import { createHash } from 'crypto';

const OUT_DIR = ".zk-comply-proof";
const CIRCUIT_DIR = "../circuits/kyc_verifier";

// Witness inputs matching the Noir circuit's public + private inputs
const INPUTS = {
  kyc_level: 1,
  country_code: 566,
  salt: "0x3039",        // 12345
  required_kyc: 1,
  allowed_country: 566,
};

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  // Dynamically generate commitment and nullifier based on other inputs
  const commitmentInput = `${INPUTS.kyc_level}-${INPUTS.country_code}-${INPUTS.salt}`;
  INPUTS.commitment = generateHash(commitmentInput);
  
  // Example derivation for nullifier (can be adjusted based on actual circuit logic)
  const nullifierInput = `${INPUTS.kyc_level}-${INPUTS.country_code}-${INPUTS.salt}-${INPUTS.commitment}`;
  INPUTS.nullifier = generateHash(nullifierInput);

  // 1) Compile Noir circuit
  console.log("Compiling Noir circuit...");
  const source = readFileSync(`${CIRCUIT_DIR}/src/main.nr`, "utf-8");
  const fm = createFileManager("/");
  fm.addFile("./main.nr", source);
  
  const compiled = await compile(fm, "./main.nr");
  console.log("  Compiled OK, bytecode size:", compiled.program.bytecode.length, "chars (base64)");

  // 2) Execute the circuit to build the witness
  console.log("Executing circuit...");
  const program = new Noir(compiled);
  const { witness } = await program.execute(INPUTS);

  // 3) Generate UltraHonk proof
  console.log("Generating UltraHonk proof...");
  const backend = new UltraHonkBackend(compiled.program.bytecode, {
    threads: 8,
    memory: { initial: 20, maximum: 512 },
  });

  // bb.js 0.87.0: the verification key is generated separately from the proof
  const { proof, publicInputs } = await backend.generateProof(witness);
  const verificationKey = await backend.getVerificationKey();
  
  // 4) Write artifacts
  writeFileSync(`${OUT_DIR}/proof`, proof);
  // Public inputs arrive as deflattened 0x-prefixed 32-byte field elements
  const publicInputsBytes = Buffer.from(
    publicInputs.map((p) => p.replace(/^0x/, "")).join(""),
    "hex"
  );
  writeFileSync(`${OUT_DIR}/public_inputs`, publicInputsBytes);
  writeFileSync(`${OUT_DIR}/vk`, verificationKey);
  
  console.log("Proof size:", proof.length, "bytes");
  console.log("Public inputs size:", publicInputsBytes.length, "bytes");
  console.log("VK size:", verificationKey.length, "bytes");
  console.log("Artifacts written to", OUT_DIR);
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});

function generateHash(input) {
  return "0x" + createHash('sha256').update(input).digest('hex');
}
