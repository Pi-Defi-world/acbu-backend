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
      logger.warn(
        "Failed to fetch dynamic Stellar base fee; falling back to configured value",
        { err, fallback: config.stellar.baseFeeStroops },
      );
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
  const { sorobanMinFeeStroops: min, sorobanMaxFeeStroops: max } =
    config.stellar;

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
