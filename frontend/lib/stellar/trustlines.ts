import {
  Asset,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { acbuAsset, demoFiatAsset } from "./demo-fiat";
import { getAssetsConfig } from "@/lib/api/config";
import { post } from "@/lib/api/client";
import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { logger } from "@/lib/logger";

const TESTNET_HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ??
  "https://horizon-testnet.stellar.org";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

async function hasTrustline(
  account: Horizon.AccountResponse,
  asset: Asset,
): Promise<boolean> {
  const code = asset.getCode();
  const issuer = asset.getIssuer();
  return account.balances.some(
    (b: { asset_type: string; asset_code?: string; asset_issuer?: string }) => {
      if (b.asset_type === "native") return false;
      return b.asset_code === code && b.asset_issuer === issuer;
    },
  );
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

async function ensureTestnetAccountExists(
  address: string,
  horizonUrl: string,
): Promise<void> {
  const server = new Horizon.Server(horizonUrl);
  try {
    await server.loadAccount(address);
    return;
  } catch (e: unknown) {
    if ((e as { response?: { status?: number } })?.response?.status !== 404)
      throw e;
  }

  // Use the shared API client so the request is routed through the correct
  // base URL (NEXT_PUBLIC_API_BASE_URL), which may include a path prefix such
  // as /api/v1.  A raw fetch("/v1/…") would bypass that prefix and hit the
  // Next.js origin instead, returning 404/405 on any correctly-configured
  // deployment.
  await post("/users/me/wallet/activate");

  for (let i = 0; i < 5; i++) {
    try {
      await server.loadAccount(address);
      return;
    } catch (e: unknown) {
      if ((e as { response?: { status?: number } })?.response?.status !== 404)
        throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw new Error(
    "Wallet activation submitted but account not visible on Horizon yet.",
  );
}

/**
 * Wait until Horizon reports the trustline on the account. Required before we
 * invoke the backend mint: Soroban simulates against the current ledger state,
 * so a freshly submitted trustline needs the ledger to close before the mint
 * contract can see it. 8 x 1.5s ≈ 12s covers the ~5s testnet ledger close time
 * with margin for RPC replication.
 */
async function waitForTrustlineVisible(params: {
  server: Horizon.Server;
  accountId: string;
  asset: Asset;
  attempts?: number;
  delayMs?: number;
}): Promise<boolean> {
  const attempts = params.attempts ?? 8;
  const delayMs = params.delayMs ?? 1500;
  for (let i = 0; i < attempts; i++) {
    try {
      const account = await params.server.loadAccount(params.accountId);
      if (await hasTrustline(account, params.asset)) return true;
    } catch {
      // keep polling; the account may be between ledger replication
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

async function addTrustlineForAsset(params: {
  userSecret?: string;
  external?: { kit: StellarWalletsKit; address: string };
  asset: Asset;
  waitForVisibility?: boolean;
}): Promise<{ added: boolean; txHash?: string; visible: boolean }> {
  const horizonUrl = await resolveHorizonUrl();
  const networkPassphrase = await resolveNetworkPassphrase();

  const server = new Horizon.Server(horizonUrl);
  const accountId = params.external?.address
    ? params.external.address
    : params.userSecret
      ? Keypair.fromSecret(params.userSecret).publicKey()
      : null;
  if (!accountId) {
    throw new Error("Missing wallet credentials (secret or external address).");
  }

  await ensureTestnetAccountExists(accountId, horizonUrl);

  const account = await server.loadAccount(accountId);
  if (await hasTrustline(account, params.asset)) {
    return { added: false, visible: true };
  }

  const op = Operation.changeTrust({ asset: params.asset });
  // Use current network base fee instead of a hardcoded value to avoid
  // transactions getting stuck during congestion. Apply a multiplier to
  // increase the chance of timely inclusion.
  const baseFee = await server.fetchBaseFee();
  const fee = String(Math.max(100, Math.ceil(baseFee * 2)));
  const tx = new TransactionBuilder(account, {
    fee,
    networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(0)
    .build();
  let res: Horizon.HorizonApi.SubmitTransactionResponse;
  if (params.external?.kit) {
    const { signedTxXdr } = await params.external.kit.signTransaction(
      tx.toXDR(),
      {
        address: accountId,
        networkPassphrase,
      },
    );
    const signed = TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase);
    res = await server.submitTransaction(signed);
  } else {
    if (!params.userSecret) throw new Error("Missing wallet secret.");
    const kp = Keypair.fromSecret(params.userSecret);
    tx.sign(kp);
    res = await server.submitTransaction(tx);
  }

  const visible =
    params.waitForVisibility === false
      ? false
      : await waitForTrustlineVisible({
          server,
          accountId,
          asset: params.asset,
        });

  return { added: true, txHash: res.hash, visible };
}

export async function ensureDemoFiatTrustlineClient(params: {
  userSecret?: string;
  external?: { kit: StellarWalletsKit; address: string };
  currency: string;
}): Promise<{ added: boolean; txHash?: string; visible: boolean }> {
  // Demo fiat issuer comes from the backend config so we always match whatever
  // the minting contract's SAC expects.
  let asset: Asset;
  try {
    const cfg = await getAssetsConfig();
    const issuer = cfg.demo_fiat.issuer;
    if (issuer) {
      asset = new Asset(params.currency.trim().toUpperCase(), issuer);
    } else {
      asset = demoFiatAsset(params.currency);
    }
  } catch {
    asset = demoFiatAsset(params.currency);
  }
  return addTrustlineForAsset({
    userSecret: params.userSecret,
    external: params.external,
    asset,
  });
}

/**
 * Ensure the recipient account trusts the ACBU asset. Required before the
 * minting contract can deposit ACBU into the user's wallet; without this the
 * mint fails with "trustline entry is missing for account". The asset info is
 * read from the backend config endpoint so the frontend never diverges from
 * whatever code/issuer the backend minting contract is bound to.
 */
export async function ensureAcbuTrustlineClient(params: {
  userSecret?: string;
  external?: { kit: StellarWalletsKit; address: string };
}): Promise<{ added: boolean; txHash?: string; visible: boolean }> {
  let asset: Asset;
  try {
    const cfg = await getAssetsConfig();
    if (cfg.acbu.issuer) {
      asset = new Asset(cfg.acbu.code || "ACBU", cfg.acbu.issuer);
    } else {
      asset = acbuAsset();
    }
  } catch {
    asset = acbuAsset();
  }
  logger.info("[trustline] ensuring ACBU trustline", {
    code: asset.getCode(),
    issuer: asset.getIssuer(),
  });
  return addTrustlineForAsset({
    userSecret: params.userSecret,
    external: params.external,
    asset,
  });
}
