/**
 * Soroban submission — mirrors repo `sdk/src/contracts.ts` `submitProof`,
 * aligned with on-chain `verify(wallet, nullifier, commitment)`.
 */

import {
  TransactionBuilder,
  Networks,
  Keypair,
  Contract,
  Address,
  nativeToScVal,
  rpc as SorobanRpc,
} from "@stellar/stellar-sdk";
import type { ProofArtifacts, VerificationResult } from "./types";

const TESTNET_RPC = "https://soroban-testnet.stellar.org";
const TESTNET_PASSPHRASE = Networks.TESTNET;

export async function submitProof(
  secretKey: string,
  contractId: string,
  artifacts: ProofArtifacts
): Promise<VerificationResult> {
  try {
    if (!artifacts.nullifier || artifacts.nullifier.length !== 32) {
      return { success: false, error: "artifacts.nullifier must be 32 bytes" };
    }
    if (!artifacts.commitment || artifacts.commitment.length !== 32) {
      return { success: false, error: "artifacts.commitment must be 32 bytes" };
    }

    const server = new SorobanRpc.Server(TESTNET_RPC);
    const keypair = Keypair.fromSecret(secretKey);
    const source = await server.getAccount(keypair.publicKey());

    const contract = new Contract(contractId);
    const tx = new TransactionBuilder(source, {
      fee: "100000",
      networkPassphrase: TESTNET_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          "verify",
          Address.fromString(keypair.publicKey()).toScVal(),
          nativeToScVal(artifacts.nullifier, {
            type: "bytesN",
            length: 32,
          }),
          nativeToScVal(artifacts.commitment, {
            type: "bytesN",
            length: 32,
          })
        )
      )
      .setTimeout(30)
      .build();

    const prepared = await server.prepareTransaction(tx);
    prepared.sign(keypair);
    const result = await server.sendTransaction(prepared);

    if (result.status === "ERROR") {
      return {
        success: false,
        error: `Status: ${result.status}`,
        txHash: result.hash,
      };
    }

    return { success: true, txHash: result.hash };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
