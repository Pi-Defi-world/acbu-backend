export type {
  Credential,
  ComplianceInput,
  ProofArtifacts,
  VerificationResult,
} from "./types";
export { computeCommitment, computeNullifier } from "./poseidon";
export { generateProof, loadCircuit, bigintToBytes32 } from "./prover";
export { submitProof } from "./contracts";
export { ZK_COMPLY_CIRCUIT_SOURCE } from "./circuit";
// W11-AUD-010: Web Worker-based prover — use this in browser contexts to avoid
// freezing the main thread during UltraHonk proof generation.
export { getProverWorker } from "./proverWorker";
export type { ProverWorkerApi } from "./proverWorker";
