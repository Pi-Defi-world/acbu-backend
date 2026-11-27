// W11-AUD-023: Import only the core primitives statically; Horizon is loaded
// dynamically to enable Next.js code-splitting for this heavy module.
import {
  Asset,
  Keypair,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { logger } from "@/lib/logger";
import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { getAssetsConfig } from "@/lib/api/config";

const TESTNET_HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ??
  "https://horizon-testnet.stellar.org";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
export const TRANSACTION_TIMEOUT_SECONDS = 60;

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error("Transfer canceled because the wallet disconnected.");
}

async function resolveHorizonUrl(): Promise<string> {
  try {
    const cfg = await getAssetsConfig();
    if (cfg.stellar.horizon_url) return cfg.stellar.horizon_url;
  } catch {
    // fall through to env default
  }
  return TESTNET_HORIZON_URL;
}

async function resolveNetworkPassphrase(): Promise<string> {
  try {
    const cfg = await getAssetsConfig();
    if (cfg.stellar.network_passphrase) return cfg.stellar.network_passphrase;
  } catch {
    // fall through
  }
  return TESTNET_PASSPHRASE;
}

async function resolveAcbuAsset(): Promise<Asset> {
  try {
    const cfg = await getAssetsConfig();
    if (cfg.acbu.issuer) {
      return new Asset(cfg.acbu.code || "ACBU", cfg.acbu.issuer);
    }
  } catch {
    // fall through to native
  }
  // Match backend behavior: if issuer is not configured, use native.
  return Asset.native();
}

export function looksLikeStellarAddress(value: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(value.trim());
}

export async function submitAcbuPaymentClient(params: {
  destination: string;
  amount: string;
  userSecret?: string;
  external?: { kit: StellarWalletsKit; address: string };
  signal?: AbortSignal;
}): Promise<{ transactionHash: string; sourceAddress: string }> {
  throwIfAborted(params.signal);
  const horizonUrl = await resolveHorizonUrl();
  throwIfAborted(params.signal);
  const networkPassphrase = await resolveNetworkPassphrase();
  throwIfAborted(params.signal);
  const asset = await resolveAcbuAsset();
  throwIfAborted(params.signal);
  // W11-AUD-023: dynamic import for Horizon to enable code-splitting
  const { Horizon } = await import("@stellar/stellar-sdk");
  throwIfAborted(params.signal);
  const server = new Horizon.Server(horizonUrl);

  const sourceAddress = params.external?.address
    ? params.external.address
    : params.userSecret
      ? Keypair.fromSecret(params.userSecret).publicKey()
      : null;
  if (!sourceAddress) {
    throw new Error("Missing wallet credentials (secret or external address).");
  }

  const sourceAccount = await server.loadAccount(sourceAddress);
  throwIfAborted(params.signal);
  // Use current network base fee instead of a hardcoded value to avoid
  // transactions getting stuck during congestion. Apply a multiplier to
  // increase the chance of timely inclusion.
  const baseFee = await server.fetchBaseFee();
  throwIfAborted(params.signal);
  const fee = String(Math.max(100, Math.ceil(baseFee * 2)));
  const tx = new TransactionBuilder(sourceAccount, {
    fee,
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: params.destination,
        asset,
        amount: params.amount,
      }),
    )
    .setTimeout(TRANSACTION_TIMEOUT_SECONDS)
    .build();

  if (params.external?.kit) {
    throwIfAborted(params.signal);
    const { address: activeAddress } = await params.external.kit.getAddress();
    throwIfAborted(params.signal);
    if (activeAddress !== sourceAddress) {
      throw new Error(
        "The connected wallet changed during transfer. Reconnect the correct wallet and try again.",
      );
    }
    const { signedTxXdr, signerAddress } =
      await params.external.kit.signTransaction(tx.toXDR(), {
        address: sourceAddress,
        networkPassphrase,
      });
    throwIfAborted(params.signal);
    if (signerAddress && signerAddress !== sourceAddress) {
      throw new Error(
        "The connected wallet signed with a different address. Reconnect the correct wallet and try again.",
      );
    }
    const signed = TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase);
    const res = await server.submitTransaction(signed);
    throwIfAborted(params.signal);
    const txHash = res.hash;
    // Poll Horizon briefly for the transaction to be included in a ledger.
    try {
      const timeoutMs = 60000;
      const started = Date.now();
      let found = false;
      while (Date.now() - started < timeoutMs) {
        throwIfAborted(params.signal);
        try {
          await server.transactions().transaction(txHash).call();
          found = true;
          break;
        } catch (err) {
          throwIfAborted(params.signal);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      throwIfAborted(params.signal);
      if (!found) logger.warn(`Stellar tx ${txHash} submitted but not found within ${timeoutMs}ms`);
    } catch (e) {
      throwIfAborted(params.signal);
      logger.warn('Error polling Horizon for tx confirmation', e);
    }
    return { transactionHash: txHash, sourceAddress };
  }

  throwIfAborted(params.signal);
  if (!params.userSecret) {
    throw new Error("Missing wallet secret.");
  }
  const kp = Keypair.fromSecret(params.userSecret);
  tx.sign(kp);
  const res = await server.submitTransaction(tx);
  throwIfAborted(params.signal);
  const txHash = res.hash;
  try {
    const timeoutMs = 60000;
    const started = Date.now();
    let found = false;
    while (Date.now() - started < timeoutMs) {
      throwIfAborted(params.signal);
      try {
        await server.transactions().transaction(txHash).call();
        found = true;
        break;
      } catch (err) {
        throwIfAborted(params.signal);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    throwIfAborted(params.signal);
    if (!found) logger.warn(`Stellar tx ${txHash} submitted but not found within ${timeoutMs}ms`);
  } catch (e) {
    throwIfAborted(params.signal);
    logger.warn('Error polling Horizon for tx confirmation', e);
  }
  return { transactionHash: txHash, sourceAddress };
}
