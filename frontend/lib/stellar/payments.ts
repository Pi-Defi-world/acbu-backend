import {
  Asset,
  Horizon,
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
}): Promise<{ transactionHash: string; sourceAddress: string }> {
  const horizonUrl = await resolveHorizonUrl();
  const networkPassphrase = await resolveNetworkPassphrase();
  const asset = await resolveAcbuAsset();
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
  // Use current network base fee instead of a hardcoded value to avoid
  // transactions getting stuck during congestion. Apply a multiplier to
  // increase the chance of timely inclusion.
  const baseFee = await server.fetchBaseFee();
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
    .setTimeout(0)
    .build();

  if (params.external?.kit) {
    const { signedTxXdr } = await params.external.kit.signTransaction(tx.toXDR(), {
      address: sourceAddress,
      networkPassphrase,
    });
    const signed = TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase);
    const res = await server.submitTransaction(signed);
    const txHash = res.hash;
    // Poll Horizon briefly for the transaction to be included in a ledger.
    try {
      const timeoutMs = 60000;
      const started = Date.now();
      let found = false;
      while (Date.now() - started < timeoutMs) {
        try {
          await server.transactions().transaction(txHash).call();
          found = true;
          break;
        } catch (err) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      if (!found) logger.warn(`Stellar tx ${txHash} submitted but not found within ${timeoutMs}ms`);
    } catch (e) {
      logger.warn('Error polling Horizon for tx confirmation', e);
    }
    return { transactionHash: txHash, sourceAddress };
  }

  if (!params.userSecret) {
    throw new Error("Missing wallet secret.");
  }
  const kp = Keypair.fromSecret(params.userSecret);
  tx.sign(kp);
  const res = await server.submitTransaction(tx);
  const txHash = res.hash;
  try {
    const timeoutMs = 60000;
    const started = Date.now();
    let found = false;
    while (Date.now() - started < timeoutMs) {
      try {
        await server.transactions().transaction(txHash).call();
        found = true;
        break;
      } catch (err) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (!found) logger.warn(`Stellar tx ${txHash} submitted but not found within ${timeoutMs}ms`);
  } catch (e) {
    logger.warn('Error polling Horizon for tx confirmation', e);
  }
  return { transactionHash: txHash, sourceAddress };
}
