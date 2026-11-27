/**
 * Soroban submission — mirrors repo `sdk/src/contracts.ts` `submitProof`,
 * aligned with the on-chain `verify_proof` entrypoint.
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
const TRANSACTION_POLL_TIMEOUT_MS = 120_000;
const INITIAL_TRANSACTION_POLL_DELAY_MS = 1_000;
const MAX_TRANSACTION_POLL_DELAY_MS = 8_000;

async function waitForTransaction(
  server: SorobanRpc.Server,
  txHash: string
) {
  const deadline = Date.now() + TRANSACTION_POLL_TIMEOUT_MS;
  let delayMs = INITIAL_TRANSACTION_POLL_DELAY_MS;
  let lastRpcError: unknown;

  while (Date.now() < deadline) {
    try {
      const result = await server.getTransaction(txHash);
      lastRpcError = undefined;
      if (result.status !== "NOT_FOUND") {
        return result;
      }
    } catch (error) {
      lastRpcError = error;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(delayMs, remainingMs))
    );
    delayMs = Math.min(delayMs * 2, MAX_TRANSACTION_POLL_DELAY_MS);
  }

  const detail = lastRpcError
    ? `: ${lastRpcError instanceof Error ? lastRpcError.message : String(lastRpcError)}`
    : "";
  throw new Error(
    `Timed out waiting for Soroban transaction ${txHash} to be finalized${detail}`
  );
}

export async function submitProof(
  secretKey: string,
  contractId: string,
  artifacts: ProofArtifacts
): Promise<VerificationResult> {
  let txHash: string | undefined;

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
          "verify_proof",
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

    txHash = result.hash;
    const finalized = await waitForTransaction(server, txHash);
    if (finalized.status !== "SUCCESS") {
      return {
        success: false,
        error:
          finalized.status === "FAILED"
            ? `Transaction failed: ${finalized.resultXdr ?? "unknown result"}`
            : `Unexpected transaction status: ${finalized.status}`,
        txHash,
      };
    }

    return { success: true, txHash };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
      ...(txHash ? { txHash } : {}),
    };
  }
}
