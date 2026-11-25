/**
 * W11-AUD-010: Main-thread Comlink proxy for the ZK prover Web Worker.
 *
 * Creates the worker once (lazily) and returns a typed Comlink-wrapped
 * interface so callers can await loadCircuit() and generateProof() without
 * blocking the browser main thread. The heavy UltraHonk WASM computation
 * runs entirely inside prover.worker.ts.
 *
 * Usage:
 *   const prover = getProverWorker();
 *   await prover.loadCircuit(ZK_COMPLY_CIRCUIT_SOURCE);
 *   const artifacts = await prover.generateProof(input);
 */

import { wrap } from "comlink";
import type { ComplianceInput, ProofArtifacts } from "./types";

export interface ProverWorkerApi {
  loadCircuit(circuitSource: string): Promise<void>;
  generateProof(input: ComplianceInput): Promise<ProofArtifacts>;
}

let workerProxy: ProverWorkerApi | null = null;

/**
 * Returns a singleton Comlink proxy to the prover Web Worker.
 * The worker is created on the first call and reused for subsequent proofs
 * within the same page session, amortising the WASM initialisation cost.
 */
export function getProverWorker(): ProverWorkerApi {
  if (!workerProxy) {
    const worker = new Worker(
      new URL("./prover.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerProxy = wrap<ProverWorkerApi>(worker);
  }
  return workerProxy;
}
