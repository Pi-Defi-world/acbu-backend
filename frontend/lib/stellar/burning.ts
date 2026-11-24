import {
  Address,
  Horizon,
  Operation,
  TransactionBuilder,
  xdr,
  rpc,
  Transaction,
  FeeBumpTransaction,
} from "@stellar/stellar-sdk";
import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { getAssetsConfig } from "@/lib/api/config";
import { Keypair } from "@stellar/stellar-sdk";

const TESTNET_HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ??
  "https://horizon-testnet.stellar.org";
const TESTNET_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
  "https://soroban-testnet.stellar.org";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

function i128ScVal(value: bigint): xdr.ScVal {
  const lo = value & BigInt("0xFFFFFFFFFFFFFFFF");
  const hi = value >> BigInt(64);
  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      lo: xdr.Uint64.fromString(lo.toString()),
      hi: xdr.Int64.fromString(hi.toString()),
    }),
  );
}

function formatSorobanError(resultXdr: string): string {
  try {
    const txResult = xdr.TransactionResult.fromXDR(resultXdr, "base64");
    const resultCode = txResult.result().switch().name;

    let detail = "";
    if (txResult.result().switch() === xdr.TransactionResultCode.txFailed()) {
      const results = txResult.result().results();
      if (results && results.length > 0) {
        const opResult = results[0]!;
        const tr = opResult.tr();
        if (tr && tr.switch().value === xdr.OperationType.invokeHostFunction().value) {
          detail = `: ${tr.invokeHostFunctionResult().switch().name}`;
        } else if (tr) {
          detail = `: ${tr.switch().name}`;
        }
      }
    }

    return `Soroban error: ${resultCode}${detail} (XDR: ${resultXdr})`;
  } catch {
    return `Soroban error (XDR: ${resultXdr})`;
  }
}

async function resolveNetworkConfig(): Promise<{
  horizonUrl: string;
  rpcUrl: string;
  networkPassphrase: string;
  burningContractId: string;
}> {
  const cfg = await getAssetsConfig();
  const burningContractId = cfg.contracts?.burning;
  if (!burningContractId) {
    throw new Error("Burning contract is not configured.");
  }
  return {
    horizonUrl: cfg.stellar.horizon_url || TESTNET_HORIZON_URL,
    rpcUrl: cfg.stellar.soroban_rpc_url || TESTNET_RPC_URL,
    networkPassphrase: cfg.stellar.network_passphrase || TESTNET_PASSPHRASE,
    burningContractId,
  };
}

async function submitAndWaitSuccess(params: {
  rpcServer: rpc.Server;
  tx: Transaction | FeeBumpTransaction;
  timeoutMs?: number;
}): Promise<{ txHash: string }> {
  const sendRes = await params.rpcServer.sendTransaction(params.tx);
  if (sendRes.status === "ERROR" || sendRes.errorResult) {
    const errXdr = sendRes.errorResult
      ? (sendRes.errorResult as unknown as { toXDR: (fmt: string) => string }).toXDR("base64")
      : "unknown";
    throw new Error(formatSorobanError(errXdr));
  }
  const txHash = sendRes.hash;
  const timeoutMs = params.timeoutMs ?? 120000;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await params.rpcServer.getTransaction(txHash);
    if (status.status === "SUCCESS") return { txHash };
    if (status.status === "FAILED") {
      throw new Error(formatSorobanError(String(status.resultXdr)));
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Timed out waiting for burn transaction confirmation.");
}

export async function submitBurnRedeemSingleClient(params: {
  userAddress: string;
  amountAcbu: string;
  currency: string;
  userSecret?: string;
  external?: { kit: StellarWalletsKit; address: string };
}): Promise<{ transactionHash: string }> {
  const { horizonUrl, rpcUrl, networkPassphrase, burningContractId } =
    await resolveNetworkConfig();
  const sourceAddress = params.external?.address
    ? params.external.address
    : params.userSecret
      ? Keypair.fromSecret(params.userSecret).publicKey()
      : null;
  if (!sourceAddress) {
    throw new Error("Missing wallet credentials (secret or external address).");
  }

  const amount7 = BigInt(Math.round(Number(params.amountAcbu) * 1e7));
  if (amount7 <= BigInt(0)) {
    throw new Error("Invalid burn amount.");
  }

  const server = new Horizon.Server(horizonUrl);
  const sourceAccount = await server.loadAccount(sourceAddress);
  const invokeOp = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(burningContractId).toScAddress(),
        functionName: xdr.ScVal.scvSymbol("redeem_single").sym()!,
        args: [
          xdr.ScVal.scvAddress(Address.fromString(params.userAddress).toScAddress()),
          xdr.ScVal.scvAddress(Address.fromString(sourceAddress).toScAddress()),
          i128ScVal(amount7),
          xdr.ScVal.scvString(params.currency.toUpperCase().slice(0, 3)),
        ],
      }),
    ),
  });
  const rpcServer = new rpc.Server(rpcUrl);
  // Fetch current network base fee and apply a small multiplier to reduce
  // chance of a transaction being delayed due to low fee.
  const baseFee = await server.fetchBaseFee();
  const fee = String(Math.max(100, Math.ceil(baseFee * 2)));
  const tx = new TransactionBuilder(sourceAccount, {
    fee,
    networkPassphrase,
  })
    .addOperation(invokeOp)
    .setTimeout(0)
    .build();

  const simulation = await rpcServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Burn simulation failed: ${simulation.error}`);
  }
  const assembled = rpc.assembleTransaction(tx, simulation).setTimeout(0).build();

  let signedTx: Transaction | FeeBumpTransaction = assembled;
  if (params.external?.kit) {
    const { signedTxXdr } = await params.external.kit.signTransaction(
      assembled.toXDR(),
      {
        address: sourceAddress,
        networkPassphrase,
      },
    );
    signedTx = TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase);
  } else {
    if (!params.userSecret) throw new Error("Missing wallet secret.");
    (signedTx as Transaction).sign(Keypair.fromSecret(params.userSecret));
  }

  const { txHash } = await submitAndWaitSuccess({
    rpcServer,
    tx: signedTx,
  });
  return { transactionHash: txHash };
}
