/**
 * Stellar transaction fee resolver.
 *
 * Retrieves the base fee to use when building Stellar transactions.
 * - When `STELLAR_USE_DYNAMIC_FEES=true` the current recommended base fee is
 *   fetched from Horizon before each call.  On any fetch failure the function
 *   falls back to the configured value transparently.
 * - When dynamic fees are disabled (the default) the configured
 *   `STELLAR_BASE_FEE_STROOPS` value is returned directly (default 100 stroops).
 *
 * All Stellar transaction builders should call this instead of hardcoding "100".
 *
 * For Soroban transactions:
 * - Use `calculateSorobanFeeWithCap()` to apply configurable min/max fee limits
 * - Resource fees are added during simulation; the function enforces caps on totals
 *
 * For classic (non-Soroban) payments:
 * - Use `getPaymentFee()` instead of `getBaseFee()`. It applies a surge buffer on
 *   top of the live base fee and clamps the result to a fee ceiling, so a
 *   transaction is not underpriced by a fee surge that happens after it was built
 *   (AB-052 / #1002).
 */
import { config } from "../../config/env";
import { stellarClient } from "./client";
import { logger } from "../../config/logger";

/**
 * Returns the Stellar base fee in stroops as a string, suitable for passing to
 * `TransactionBuilder` options.
 */
export async function getBaseFee(): Promise<string> {
  if (config.stellar.useDynamicFees) {
    try {
      const baseFee = await stellarClient.getServer().fetchBaseFee();
      return String(baseFee);
    } catch (err) {
      logger.warn("Failed to fetch dynamic Stellar base fee; falling back to configured value", {
        err,
        fallback: config.stellar.baseFeeStroops,
      });
    }
  }
  return String(config.stellar.baseFeeStroops);
}

/**
 * Fetch the current base fee from Horizon (always attempts dynamic fetch).
 * Unlike getBaseFee(), this always tries to get the live network fee.
 * Throws on error; caller decides whether to retry or use fallback.
 */
export async function fetchDynamicBaseFee(): Promise<number> {
  return await stellarClient.getServer().fetchBaseFee();
}

/**
 * Calculate total Soroban transaction fee, enforcing min/max caps.
 * Use this after assembling Soroban transactions to ensure fees are within limits.
 *
 * @param totalFeeStroops - Total fee (base + resource fees) in stroops
 * @returns Capped fee in stroops as a string
 */
export function calculateSorobanFeeWithCap(totalFeeStroops: number): string {
  const { sorobanMinFeeStroops: min, sorobanMaxFeeStroops: max } = config.stellar;

  const capped = Math.max(min, Math.min(max, totalFeeStroops));

  if (capped !== totalFeeStroops) {
    logger.info("Soroban fee capped", {
      original: totalFeeStroops,
      capped,
      min,
      max,
    });
  }

  return String(capped);
}

/**
 * Get fee cap configuration for logging/diagnostics.
 */
export function getFeeCapConfig(): {
  minFeeStroops: number;
  maxFeeStroops: number;
} {
  return {
    minFeeStroops: config.stellar.sorobanMinFeeStroops,
    maxFeeStroops: config.stellar.sorobanMaxFeeStroops,
  };
}

// ─── Classic (non-Soroban) payment fee strategy (AB-052 / #1002) ─────────────

/** Fallbacks used when a fee knob is absent or non-numeric on the config object. */
const DEFAULT_FEE_SURGE_BUFFER_BPS = 2000;
const DEFAULT_MAX_PAYMENT_FEE_STROOPS = 1_000_000;

/** Read a numeric config knob, falling back when unset/invalid (defensive against partial config objects). */
function numericConfig(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Surge buffer in basis points applied on top of the live base fee for classic payments. */
export function getFeeSurgeBufferBps(): number {
  return numericConfig(config.stellar.feeSurgeBufferBps, DEFAULT_FEE_SURGE_BUFFER_BPS);
}

/** Hard ceiling, in stroops, for the fee of a single classic payment. */
export function getMaxPaymentFeeStroops(): number {
  return numericConfig(config.stellar.maxPaymentFeeStroops, DEFAULT_MAX_PAYMENT_FEE_STROOPS);
}

/** Outcome of applying the surge buffer and fee ceiling to a network base fee. */
export interface PaymentFeeQuote {
  /** Fee to attach to the transaction, in stroops. */
  feeStroops: number;
  /** The base fee the quote was derived from, in stroops. */
  networkFeeStroops: number;
  /** True when the surge buffer was applied on top of `networkFeeStroops`. */
  buffered: boolean;
  /**
   * True when the buffered fee had to be clamped down to the configured ceiling.
   * When this is set, `feeStroops` is below the network's own base fee, so the
   * transaction is guaranteed to be rejected and must not be submitted.
   */
  clampedToCeiling: boolean;
  /** The ceiling that was applied, in stroops. */
  maxFeeStroops: number;
}

/**
 * Apply the configured surge buffer and fee ceiling to a network base fee.
 *
 * Stellar rejects a transaction with `tx_insufficient_fee` when its fee is below
 * the network's current base fee, and a fee read once at build time can be stale
 * by the time the transaction is submitted under load. Pricing a little above the
 * live base fee absorbs that movement, while the ceiling bounds how much a single
 * payment can ever be charged.
 *
 * Pure and synchronous so callers can re-validate a fee as often as they like.
 */
export function applyFeeSurgeBuffer(
  networkFeeStroops: number,
  maxFeeStroops: number = getMaxPaymentFeeStroops(),
  bufferBps: number = getFeeSurgeBufferBps(),
): PaymentFeeQuote {
  if (!Number.isFinite(networkFeeStroops) || networkFeeStroops < 0) {
    throw new Error(`Invalid Stellar base fee: ${networkFeeStroops}`);
  }
  if (!Number.isFinite(maxFeeStroops) || maxFeeStroops < 0) {
    throw new Error(`Invalid Stellar max payment fee: ${maxFeeStroops}`);
  }
  if (!Number.isFinite(bufferBps) || bufferBps < 0) {
    throw new Error(`Invalid Stellar fee surge buffer: ${bufferBps}`);
  }

  const buffered = Math.ceil(networkFeeStroops * (1 + bufferBps / 10_000));
  const feeStroops = Math.min(buffered, maxFeeStroops);

  return {
    feeStroops,
    networkFeeStroops,
    buffered: buffered > networkFeeStroops,
    clampedToCeiling: feeStroops < buffered,
    maxFeeStroops,
  };
}

/**
 * Resolve the fee to attach to a classic payment, priced against the current
 * network base fee (read now, not cached from an earlier build).
 *
 * Throws when the base fee cannot be read as a number. This is deliberately
 * loud: passing a non-numeric fee on to `TransactionBuilder` fails deep inside
 * BigNumber arithmetic with an opaque "[BigNumber Error] Not a number" message
 * (AB-052), which is exactly how the undeclared `STELLAR_BASE_FEE_STROOPS`
 * regression presented itself.
 */
export async function getPaymentFee(): Promise<PaymentFeeQuote> {
  const raw = await getBaseFee();
  const networkFeeStroops = Number.parseInt(raw, 10);
  if (!Number.isFinite(networkFeeStroops)) {
    throw new Error(
      `Stellar base fee is not a number (received "${raw}"). ` +
        "Check STELLAR_BASE_FEE_STROOPS and STELLAR_USE_DYNAMIC_FEES.",
    );
  }
  return applyFeeSurgeBuffer(networkFeeStroops);
}
