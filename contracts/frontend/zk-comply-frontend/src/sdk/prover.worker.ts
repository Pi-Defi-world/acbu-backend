/**
 * W11-AUD-010: Dedicated Web Worker for ZK proof generation.
 *
 * UltraHonk + Noir proving burns 100 % CPU for 10–30 seconds. Running it on
 * the main thread freezes the browser tab, drops network sockets, and triggers
 * "Page Unresponsive" dialogs. This worker moves all heavy WASM computation
 * off the main thread so the UI stays responsive throughout proving.
 *
 * The worker's API surface is exposed via Comlink so the main thread can call
 * loadCircuit() and generateProof() as ordinary async functions through a
 * transparent MessageChannel proxy (see proverWorker.ts).
 */

import { expose } from "comlink";
import { Noir } from "@noir-lang/noir_js";
import { UltraHonkBackend } from "@aztec/bb.js";
import { compile, createFileManager } from "@noir-lang/noir_wasm";
import { computeCommitment, computeNullifier } from "./poseidon";
import type { ComplianceInput, ProofArtifacts } from "./types";

let compiled: Awaited<ReturnType<typeof compile>> | null = null;
let backend: UltraHonkBackend | null = null;

function bigintToBytes32(n: bigint): Uint8Array {
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

const proverWorker = {
  /**
   * Compile the Noir circuit source and initialise the UltraHonk backend.
   * Must be called once before generateProof().
   */
  async loadCircuit(circuitSource: string): Promise<void> {
    const fm = createFileManager("/");
    (fm as { addFile: (path: string, contents: string) => void }).addFile(
      "./main.nr",
      circuitSource,
    );
    compiled = await compile(fm, "./main.nr");
    const bytecode = (compiled as { program: { bytecode: string } }).program
      .bytecode;
    backend = new UltraHonkBackend(bytecode, {
      // Use all available hardware threads inside the worker; falls back to 4.
      threads:
        (typeof navigator !== "undefined" && navigator.hardwareConcurrency) ||
        4,
    });
  },

  /**
   * Generate a UltraHonk zero-knowledge compliance proof.
   * Raw credential data never leaves the worker — only the proof artifacts
   * are transferred back to the main thread.
   */
  async generateProof(input: ComplianceInput): Promise<ProofArtifacts> {
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
        .join(""),
    );

    return {
      proof:
        proof instanceof Uint8Array
          ? proof
          : Uint8Array.from(proof as ArrayLike<number>),
      publicInputs: publicInputsBytes,
      vk:
        vk instanceof Uint8Array
          ? vk
          : Uint8Array.from(vk as ArrayLike<number>),
      nullifier: bigintToBytes32(nullifier),
      commitment: bigintToBytes32(commitment),
    };
  },
};

expose(proverWorker);
