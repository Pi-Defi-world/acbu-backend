/**
 * Types for the ZK-Comply protocol.
 */

export interface Credential {
  kycLevel: number;
  countryCode: number;
  salt: bigint;
}

export interface ComplianceInput {
  credential: Credential;
  requiredKyc: number;
  allowedCountry: number;
}

export interface ProofArtifacts {
  proof: Uint8Array;
  publicInputs: Uint8Array;
  vk: Uint8Array;
  /** 32-byte Poseidon2 nullifier (public input). */
  nullifier: Uint8Array;
  /** 32-byte Poseidon2 credential commitment (public input). */
  commitment: Uint8Array;
}

export interface VerificationResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

/**
 * A KYC attestation issued by the trusted KYC authority (ACBU backend).
 *
 * The authority derives `kycLevel` / `countryCode` from its own verified
 * records and computes:
 *   - `commitment` = poseidon2(kycLevel, countryCode, salt)
 *   - `attestedCredential` = poseidon2(kycLevel, countryCode)
 * and registers the commitment on-chain via `registerCommitment` (AZ-002).
 * Proofs may only use attested credentials — self-asserted values are
 * rejected by the verifier contract.
 */
export interface KycAttestation {
  commitment: string;
  attestedCredential: string;
  kycLevel: number;
  countryCode: number;
}
