/**
 * Proof generation using Noir + UltraHonk in the browser.
 *
 * Matches `generate-artifacts.mjs`: Noir 1.0.0-beta.9 + bb.js 0.87.0.
 * Raw credential data never leaves the user's device.
 */

import { Noir } from "@noir-lang/noir_js";
import { UltraHonkBackend } from "@aztec/bb.js";
import { compile, createFileManager } from "@noir-lang/noir_wasm";
import type { ProofArtifacts, ComplianceInput } from "./types.js";
import {
  computeCommitment,
  computeNullifier,
  fieldToBytes32,
} from "./poseidon.js";

let compiled: Awaited<ReturnType<typeof compile>> | null = null;
let backend: UltraHonkBackend | null = null;

/** Encode a bigint as a 32-byte big-endian field element. */
export function bigintToBytes32(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, "0");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function fieldHex(n: bigint): string {
  return "0x" + n.toString(16);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Load and initialize the Noir circuit.
 * Call once at app startup (or before the first prove).
 */
export async function loadCircuit(circuitSource: string): Promise<void> {
  const fm = createFileManager("/");
  // noir_wasm FileManager: addFile is the stable API used by generate-artifacts.mjs
  (fm as { addFile: (path: string, contents: string) => void }).addFile(
    "./main.nr",
    circuitSource
  );

  compiled = await compile(fm, "./main.nr");
  const bytecode = (compiled as { program: { bytecode: string } }).program
    .bytecode;
  backend = new UltraHonkBackend(bytecode, {
    threads:
      (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4,
  });
}

/**
 * Generate a zero-knowledge compliance proof.
 *
 * The raw credential data (kycLevel, countryCode, salt) never
 * leaves the browser — it's fed directly into the Wasm prover.
 * Only the proof and public inputs are returned.
 */
export async function generateProof(
  input: ComplianceInput
): Promise<ProofArtifacts> {
  if (!compiled || !backend) {
    throw new Error("Circuit not loaded. Call loadCircuit() first.");
  }

  const commitment = await computeCommitment(input.credential);
  const nullifier = await computeNullifier(commitment, input.credential.salt);

  const circuitInputs = {
    kyc_level: input.credential.kycLevel,
    country_code: input.credential.countryCode,
    salt: fieldHex(input.credential.salt),
    commitment: fieldHex(commitment),
    required_kyc: input.requiredKyc,
    allowed_country: input.allowedCountry,
    nullifier: fieldHex(nullifier),
  };

  const program = new Noir(compiled as never);
  const { witness } = await program.execute(circuitInputs);
  const { proof, publicInputs } = await backend.generateProof(witness);
  const vk = await backend.getVerificationKey();

  const publicInputsBytes = hexToBytes(
    (publicInputs as string[])
      .map((p) => p.replace(/^0x/, "").padStart(64, "0"))
      .join("")
  );

  return {
    proof: proof instanceof Uint8Array ? proof : Uint8Array.from(proof as ArrayLike<number>),
    publicInputs: publicInputsBytes,
    vk: vk instanceof Uint8Array ? vk : Uint8Array.from(vk as ArrayLike<number>),
    nullifier: bigintToBytes32(nullifier),
    commitment: bigintToBytes32(commitment),
  };
}
