/**
 * USDC→XLM swap via the Stellar DEX (pathPaymentStrictSend).
 *
 * The backend's configured STELLAR_SECRET_KEY keypair is the source AND
 * destination of the swap: it spends USDC and receives XLM into the same
 * account. Horizon's strict-send path-finding endpoint is queried first so
 * we have an expected output amount; a configurable slippage tolerance
 * (USDC_XLM_SLIPPAGE_BPS, default 50 bps = 0.5%) is applied to derive the
 * minimum acceptable XLM before submitting the transaction.
 *
 * Throws on any failure — the caller (usdcConvertAndMintJob) should NOT mint
 * ACBU unless this function resolves successfully.
 */

import { Asset, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { config } from "../../config/env";
import { logger } from "../../config/logger";
import { stellarClient } from "./client";
import { getBaseFee } from "./feeManager";

/** Slippage tolerance in basis points. Default 50 = 0.5%. */
const SLIPPAGE_BPS = parseInt(process.env.USDC_XLM_SLIPPAGE_BPS ?? "50", 10);

/** Maximum seconds the swap transaction is valid on-chain. */
const SWAP_TIMEOUT_SECONDS = 30;

export interface SwapResult {
  /** Estimated XLM received (from Horizon path-finding; actual ledger amount
   *  may vary by at most SLIPPAGE_BPS / 10 000). */
  xlmReceived: number;
  /** Transaction hash of the submitted Stellar transaction. */
  txHash: string;
}

/**
 * Swap `usdcAmount` USDC for XLM on the Stellar DEX.
 *
 * Steps:
 *  1. Resolve the USDC asset issuer for the configured network.
 *  2. Query Horizon strict-send paths to get the expected XLM output.
 *  3. Build a pathPaymentStrictSend operation with slippage protection.
 *  4. Sign with the backend keypair and submit.
 *
 * @param usdcAmount  Exact USDC to spend (human units, e.g. 100.25).
 * @returns SwapResult containing estimated XLM received and tx hash.
 * @throws  if keypair is missing, no DEX path exists, or submission fails.
 */
export async function swapUsdcToXlm(usdcAmount: number): Promise<SwapResult> {
  const network = config.stellar.network;
  const usdcIssuer =
    network === "mainnet" ? config.stellar.usdcIssuerMainnet : config.stellar.usdcIssuerTestnet;
  const usdcAssetCode =
    network === "mainnet"
      ? config.stellar.usdcAssetCodeMainnet
      : config.stellar.usdcAssetCodeTestnet;
  if (!usdcIssuer) {
    throw new Error(
      `No USDC issuer configured for Stellar network "${network}". ` +
        `Set USDC_ISSUER_TESTNET or USDC_ISSUER_MAINNET.`,
    );
  }

  const keypair = stellarClient.getKeypair();
  if (!keypair) {
    throw new Error(
      "STELLAR_SECRET_KEY is not configured; cannot perform USDC→XLM swap on Stellar DEX.",
    );
  }

  const server = stellarClient.getServer();
  const usdcAsset = new Asset(usdcAssetCode, usdcIssuer);
  const xlmAsset = Asset.native();
  const sendAmountStr = usdcAmount.toFixed(7);
  const backendPublicKey = keypair.publicKey();

  // ── 1. Find the best strict-send path via Horizon ────────────────────────
  const pathsResult = await server.strictSendPaths(usdcAsset, sendAmountStr, [xlmAsset]).call();

  const bestPath = pathsResult.records.find(
    (r: { destination_asset_type: string }) => r.destination_asset_type === "native",
  ) as { destination_amount: string } | undefined;

  if (!bestPath) {
    throw new Error(
      `Stellar DEX has no ${usdcAssetCode}→XLM path for ${usdcAmount} ${usdcAssetCode}. ` +
        `The liquidity pool may be empty or the amount is too small.`,
    );
  }

  const expectedXlm = parseFloat(bestPath.destination_amount);
  const slippageFactor = 1 - SLIPPAGE_BPS / 10_000;
  const destMinStr = (expectedXlm * slippageFactor).toFixed(7);

  logger.info("USDC→XLM path found", {
    usdcSpent: usdcAmount,
    xlmExpected: expectedXlm,
    destMin: destMinStr,
    slippageBps: SLIPPAGE_BPS,
  });

  // ── 2. Build, sign, and submit the swap transaction ───────────────────────
  const fee = await getBaseFee();
  const sourceAccount = await server.loadAccount(backendPublicKey);

  const tx = new TransactionBuilder(sourceAccount, {
    fee,
    networkPassphrase: stellarClient.getNetworkPassphrase(),
  })
    .addOperation(
      Operation.pathPaymentStrictSend({
        sendAsset: usdcAsset,
        sendAmount: sendAmountStr,
        // The backend receives XLM into its own account; it is not forwarded
        // to the user's wallet directly — minting ACBU is a separate step.
        destination: backendPublicKey,
        destAsset: xlmAsset,
        destMin: destMinStr,
        path: [], // empty = direct AMM/liquidity-pool route
      }),
    )
    .setTimeout(SWAP_TIMEOUT_SECONDS)
    .build();

  tx.sign(keypair);

  const result = await server.submitTransaction(tx);

  logger.info("USDC→XLM swap confirmed on Stellar DEX", {
    txHash: result.hash,
    usdcSpent: usdcAmount,
    xlmExpected: expectedXlm,
    destMin: destMinStr,
  });

  return { xlmReceived: expectedXlm, txHash: result.hash };
}
