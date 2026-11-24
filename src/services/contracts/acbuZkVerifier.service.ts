import { xdr } from "@stellar/stellar-sdk";
import { contractClient, ContractClient } from "../stellar/contractClient";
import { stellarClient } from "../stellar/client";
import { logger } from "../../config/logger";

/**
 * Parameters for submitting a ZK eligibility proof to the on-chain verifier.
 *
 * The Soroban `acbu-zk` contract ABI for `submit_proof` accepts exactly two
 * arguments:
 *
 *   submit_proof(proof: Bytes, public_inputs: Bytes) -> VerifyResult
 *
 * Previous SDK drafts (see SC#1017 / W10-Z-003) incorrectly serialised a
 * leading `user` address parameter that is not part of the contract signature.
 * This caused an argument-count deserialization failure in the Soroban VM.
 *
 * The caller's identity is already captured by `require_auth()` inside the
 * contract and by the transaction's source account — an extra `user` argument
 * is unnecessary and breaks the ABI.
 */
export interface SubmitProofParams {
  /** Raw proof bytes (e.g. Groth16/PLONK serialised proof). */
  proof: Uint8Array;
  /** Public inputs bytes consumed by the verifier circuit. */
  publicInputs: Uint8Array;
}

export interface VerifyResult {
  /** Whether the proof verified successfully. */
  verified: boolean;
  /** The policy version the verifier evaluated against. */
  policyVersion: number;
}

export class ZkVerifierService {
  private contractId: string;
  private contractClient: ContractClient;

  constructor(contractId: string) {
    this.contractId = contractId;
    this.contractClient = contractClient;
  }

  /**
   * Submit a ZK eligibility proof to the on-chain verifier.
   *
   * Contract ABI: `submit_proof(proof: Bytes, public_inputs: Bytes)`
   *
   * **Important**: only `proof` and `public_inputs` are passed as invocation
   * arguments.  The caller's identity is derived from the transaction's source
   * account and `require_auth()` inside the contract — do NOT prepend a `user`
   * address parameter (see W11-CAR-019 / SC#1017).
   */
  async submitProof(params: SubmitProofParams): Promise<{
    transactionHash: string;
    verified: boolean;
    policyVersion: number;
  }> {
    try {
      logger.info("Submitting ZK proof to on-chain verifier", {
        contractId: this.contractId,
        proofLength: params.proof.length,
        publicInputsLength: params.publicInputs.length,
      });

      const sourceAccount = stellarClient.getKeypair()?.publicKey();
      if (!sourceAccount) {
        throw new Error("No source account available");
      }

      // ---------------------------------------------------------------
      // FIX (W11-CAR-019): align with contract ABI.
      //
      // The Soroban contract signature is:
      //   submit_proof(proof: Bytes, public_inputs: Bytes) -> VerifyResult
      //
      // The *incorrect* previous draft passed:
      //   [user, proof, public_inputs]       ← 3 args (WRONG)
      //
      // Correct invocation passes only:
      //   [proof, public_inputs]             ← 2 args (CORRECT)
      //
      // The `user` identity is already available to the contract via
      // `require_auth()` and the transaction source account.
      // ---------------------------------------------------------------
      const args: xdr.ScVal[] = [
        ContractClient.toScVal(params.proof),
        ContractClient.toScVal(params.publicInputs),
      ];

      const result = await this.contractClient.invokeContract({
        contractId: this.contractId,
        functionName: "submit_proof",
        args,
        sourceAccount,
      });

      // Parse the VerifyResult struct: { verified: bool, policy_version: u32 }
      const resultValue = ContractClient.fromScVal(result.result);
      const resultArray = resultValue as unknown[];
      const verified = Boolean(resultArray?.[0] ?? false);
      const policyVersion = Number(resultArray?.[1] ?? 0);

      logger.info("ZK proof submission result", {
        transactionHash: result.transactionHash,
        verified,
        policyVersion,
      });

      return {
        transactionHash: result.transactionHash,
        verified,
        policyVersion,
      };
    } catch (error) {
      logger.error("Failed to submit ZK proof", {
        contractId: this.contractId,
        error,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Read the current policy version from the verifier contract (read-only).
   */
  async getPolicyVersion(): Promise<number> {
    try {
      const result = await this.contractClient.readContract(
        this.contractId,
        "get_policy_version",
        [],
      );

      return Number(ContractClient.fromScVal(result));
    } catch (error) {
      logger.error("Failed to read policy version", {
        contractId: this.contractId,
        error,
      });
      throw error;
    }
  }

  /**
   * Read the current revocation root from the verifier contract (read-only).
   */
  async getRevocationRoot(): Promise<string> {
    try {
      const result = await this.contractClient.readContract(
        this.contractId,
        "get_revocation_root",
        [],
      );

      return ContractClient.fromScVal(result) as string;
    } catch (error) {
      logger.error("Failed to read revocation root", {
        contractId: this.contractId,
        error,
      });
      throw error;
    }
  }
}
