import {
  TransactionBuilder,
  Operation,
  xdr,
  Address,
  rpc,
} from "@stellar/stellar-sdk";
import { stellarClient } from "./client";
import { getBaseFee } from "./feeManager";
import { logger } from "../../config/logger";
import { wrapSorobanInvokeError } from "./sorobanInvokeErrors";

function isRetryableSorobanNetworkError(message: string): boolean {
  return /ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED|fetch failed|socket hang up/i.test(
    message,
  );
}

async function simulateTransactionWithRetry(
  rpcServer: rpc.Server,
  transaction: Parameters<rpc.Server["simulateTransaction"]>[0],
  logCtx: Record<string, unknown>,
): Promise<rpc.Api.SimulateTransactionResponse> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await rpcServer.simulateTransaction(transaction);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!isRetryableSorobanNetworkError(msg) || attempt === 3) {
        throw e;
      }
      logger.warn("Soroban simulateTransaction failed (retrying)", {
        ...logCtx,
        attempt,
        message: msg,
      });
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw new Error("simulateTransactionWithRetry: exhausted retries");
}

export interface ContractCallOptions {
  contractId: string;
  functionName: string;
  args: xdr.ScVal[];
  sourceAccount: string;
  fee?: string;
}

export interface ContractInvokeResult {
  transactionHash: string;
  result: xdr.ScVal;
  ledger: number;
}

export class ContractClient {
  // private server: ReturnType<typeof stellarClient.getServer>;
  private networkPassphrase: string;

  constructor() {
    // this.server = stellarClient.getServer();
    this.networkPassphrase = stellarClient.getNetworkPassphrase();
  }

  /**
   * Helper to convert BigInt to ScVal i128
   */
  static bigIntToI128(value: bigint): xdr.ScVal {
    const b = BigInt(value);
    const lo = b & BigInt("0xFFFFFFFFFFFFFFFF");
    const hi = b >> BigInt(64);
    return xdr.ScVal.scvI128(
      new xdr.Int128Parts({
        lo: xdr.Uint64.fromString(lo.toString()),
        hi: xdr.Int64.fromString(hi.toString()),
      }),
    );
  }

  /**
   * Invoke a contract function
   */
  async invokeContract(
    options: ContractCallOptions,
  ): Promise<ContractInvokeResult> {
    try {
      const { contractId, functionName, args, sourceAccount, fee } = options;

      logger.info("Invoking contract function", {
        contractId,
        functionName,
        sourceAccount,
      });

      const invokeOp = Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(contractId).toScAddress(),
            functionName: xdr.ScVal.scvSymbol(functionName).sym()!,
            args,
          }),
        ),
      });

      const sourceAccountObj = await stellarClient.getAccount(sourceAccount);
      const builder = new TransactionBuilder(sourceAccountObj, {
        fee: fee || (await getBaseFee()),
        networkPassphrase: this.networkPassphrase,
      });
      builder.setTimeout(0);

      builder.addOperation(invokeOp);
      let transaction = builder.build();

      const rpcServer = new rpc.Server(stellarClient.getSorobanRpcUrl());
      // Simulate first so we can attach Soroban auth + resource footprint/fees.
      // This is required for contracts that call `require_auth()` (admin/validator gated).
      const simulation = await simulateTransactionWithRetry(
        rpcServer,
        transaction,
        {
          contractId,
          functionName,
        },
      );
      if (rpc.Api.isSimulationError(simulation)) {
        throw new Error(`Simulation error: ${simulation.error}`);
      }
      transaction = rpc
        .assembleTransaction(transaction, simulation)
        .setTimeout(0)
        .build();

      const keypair = stellarClient.getKeypair();
      if (keypair) {
        transaction.sign(keypair);
      }

      // IMPORTANT: Soroban transactions should be submitted to the Soroban RPC,
      // not Horizon `/transactions` (which can 504 on long-running Soroban TXs).
      let send: any;
      let lastSendError: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          send = await rpcServer.sendTransaction(transaction);
          break;
        } catch (e) {
          lastSendError = e;
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn("Soroban RPC sendTransaction failed (retrying)", {
            contractId,
            functionName,
            attempt,
            message: msg,
          });
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 1500 * attempt));
          }
        }
      }
      if (!send) {
        throw lastSendError instanceof Error
          ? lastSendError
          : new Error(String(lastSendError));
      }
      const txHash = send.hash;

      // Poll until the transaction is confirmed.
      const maxWaitMs = 120_000;
      const start = Date.now();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        let status: any;
        try {
          status = await rpcServer.getTransaction(txHash);
        } catch (e) {
          // Soroban testnet RPC can intermittently reset connections; treat as retryable while within maxWaitMs.
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn("Soroban RPC getTransaction failed (retrying)", {
            contractId,
            functionName,
            txHash,
            message: msg,
          });
          if (Date.now() - start > maxWaitMs) {
            throw e;
          }
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        if (status.status === "SUCCESS") {
          // For Soroban invocations the real contract return value is carried
          // in `TransactionMeta.sorobanMeta.returnValue`, which the RPC exposes
          // directly as `status.returnValue` (already parsed to xdr.ScVal).
          // The `InvokeHostFunctionResult.success()` arm in `TransactionResult`
          // is only the hash of emitted diagnostic events — not the return
          // value. Prefer `returnValue`; fall back to TransactionResult parsing
          // for non-Soroban paths or older RPC responses.
          let resultScVal: xdr.ScVal;
          if (status.returnValue) {
            resultScVal = status.returnValue as xdr.ScVal;
          } else {
            resultScVal = this.parseTransactionResult(status);
          }
          return {
            transactionHash: txHash,
            result: resultScVal,
            ledger: status.ledger ?? 0,
          };
        }
        if (status.status === "FAILED") {
          throw new Error(
            `Soroban transaction failed: ${status.resultXdr ?? "unknown result"}`,
          );
        }
        if (Date.now() - start > maxWaitMs) {
          throw new Error(`Soroban transaction timed out after ${maxWaitMs}ms`);
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (error) {
      logger.error("Failed to invoke contract", {
        contractId: options.contractId,
        functionName: options.functionName,
        error,
        message: error instanceof Error ? error.message : String(error),
      });
      throw wrapSorobanInvokeError(error, {
        contractId: options.contractId,
        functionName: options.functionName,
      });
    }
  }

  /**
   * Read contract data (simulate call without submitting)
   */
  async readContract(
    contractId: string,
    functionName: string,
    args: xdr.ScVal[],
  ): Promise<xdr.ScVal> {
    try {
      logger.info("Reading contract data", { contractId, functionName });

      const sourceAccount = stellarClient.getKeypair()?.publicKey();
      if (!sourceAccount) {
        throw new Error("No source account available for contract read");
      }

      const invokeOp = Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(contractId).toScAddress(),
            functionName: xdr.ScVal.scvSymbol(functionName).sym()!,
            args,
          }),
        ),
      });

      const sourceAccountObj = await stellarClient.getAccount(sourceAccount);
      const builder = new TransactionBuilder(sourceAccountObj, {
        fee: await getBaseFee(),
        networkPassphrase: this.networkPassphrase,
      });
      builder.setTimeout(0);

      builder.addOperation(invokeOp);
      const transaction = builder.build();

      const rpcServer = new rpc.Server(stellarClient.getSorobanRpcUrl());
      const simulation = await simulateTransactionWithRetry(
        rpcServer,
        transaction,
        {
          contractId,
          functionName,
        },
      );

      if (rpc.Api.isSimulationError(simulation)) {
        throw new Error(`Simulation error: ${simulation.error}`);
      }

      // If it's a success, it will have a result
      if (rpc.Api.isSimulationSuccess(simulation)) {
        return simulation.result!.retval;
      }

      throw new Error("Simulation neither error nor success");
    } catch (error) {
      logger.error("Failed to read contract", {
        contractId,
        functionName,
        error,
      });
      throw error;
    }
  }

  /**
   * Parse transaction result
   */
  private parseTransactionResult(result: any): xdr.ScVal {
    try {
      const rawResultXdr =
        // Horizon shape
        result?.result_xdr ??
        // Soroban RPC `getTransaction` shape
        result?.resultXdr ??
        result?.result_xdr;

      if (rawResultXdr) {
        // Newer stellar-sdk versions may already parse `resultXdr` into an XDR struct.
        // Normalize into a base64 string for `fromXDR`.
        const resultXdrBase64: string =
          typeof rawResultXdr === "string"
            ? rawResultXdr
            : typeof rawResultXdr?.toXDR === "function"
              ? rawResultXdr.toXDR("base64")
              : Buffer.isBuffer(rawResultXdr)
                ? rawResultXdr.toString("base64")
                : String(rawResultXdr);

        const txResult = xdr.TransactionResult.fromXDR(
          resultXdrBase64,
          "base64",
        );
        const results = txResult.result().results();
        if (results.length > 0) {
          const tr = results[0].tr();
          // Check for host function success
          const opResult = tr.invokeHostFunctionResult();
          if (
            opResult.switch() ===
            xdr.InvokeHostFunctionResultCode.invokeHostFunctionSuccess()
          ) {
            return opResult.success() as unknown as xdr.ScVal;
          }
        }
      }
      throw new Error("Could not parse transaction result");
    } catch (error) {
      logger.error("Failed to parse transaction result", { error });
      throw error;
    }
  }

  /**
   * Convert JavaScript value to ScVal
   */
  static toScVal(value: any): xdr.ScVal {
    if (typeof value === "string") {
      try {
        // Try to parse as Address if it looks like one
        if (/^[GC][A-Z2-7]{55}$/.test(value)) {
          return xdr.ScVal.scvAddress(Address.fromString(value).toScAddress());
        }
      } catch {
        // Fallback to string if parsing fails
      }
      return xdr.ScVal.scvString(value);
    } else if (typeof value === "number" || typeof value === "bigint") {
      return ContractClient.bigIntToI128(BigInt(value));
    } else if (typeof value === "boolean") {
      return xdr.ScVal.scvBool(value);
    } else if (value instanceof Uint8Array) {
      return xdr.ScVal.scvBytes(Buffer.from(value));
    } else if (Array.isArray(value)) {
      const vec = value.map((v) => ContractClient.toScVal(v));
      return xdr.ScVal.scvVec(vec);
    } else {
      throw new Error(`Unsupported value type: ${typeof value}`);
    }
  }

  /**
   * Convert ScVal to JavaScript value
   */
  static fromScVal(scVal: xdr.ScVal): any {
    switch (scVal.switch()) {
      case xdr.ScValType.scvBool():
        return scVal.b();
      case xdr.ScValType.scvVoid():
        return null;
      case xdr.ScValType.scvU32():
        return scVal.u32();
      case xdr.ScValType.scvI32():
        return scVal.i32();
      case xdr.ScValType.scvU64():
        return scVal.u64().toBigInt().toString();
      case xdr.ScValType.scvI64():
        return scVal.i64().toBigInt().toString();
      case xdr.ScValType.scvU128():
      case xdr.ScValType.scvI128(): {
        const parts =
          scVal.switch() === xdr.ScValType.scvU128()
            ? scVal.u128()
            : scVal.i128();
        const lo = parts.lo().toBigInt();
        const hi = parts.hi().toBigInt();
        return (hi << BigInt(64)) | lo;
      }
      case xdr.ScValType.scvString():
        return scVal.str().toString();
      case xdr.ScValType.scvBytes():
        return scVal.bytes();
      case xdr.ScValType.scvVec():
        return (scVal.vec() ?? []).map((v: xdr.ScVal) =>
          ContractClient.fromScVal(v),
        );
      case xdr.ScValType.scvAddress():
        return Address.fromScVal(scVal).toString();
      default:
        return scVal;
    }
  }
}

export const contractClient = new ContractClient();
