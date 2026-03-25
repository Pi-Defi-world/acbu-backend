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
