/**
 * ZK-Comply SDK
 *
 * Generates zero-knowledge compliance proofs in the browser and
 * submits them to the Stellar Soroban verifier contract.
 */

export { computeCommitment, computeNullifier, computeAttestedCredential } from "./poseidon.js";
export { generateProof, loadCircuit, bigintToBytes32 } from "./prover.js";
export { submitProof, deployVerifier, deployGate, registerCommitment } from "./contracts.js";
export type { Credential, ComplianceInput, ProofArtifacts, KycAttestation } from "./types.js";
