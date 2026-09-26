/**
 * Fee policy: dynamic fees based on reserve levels (and optional demand).
 * Spread: buy/sell spread for rates/quote (0.2–0.3%).
 *
 * FEE TIER SPECIFICATION:
 * ========================
 * Mint Fees (based on reserve ratio):
 * - Normal: 30 BPS (0.30%) when ratio >= minRatio (1.02)
 * - Stressed: 50 BPS (0.50%) when ratio < minRatio
 * - Max cap: 100 BPS (1.00%)
 *
 * Burn Fees (based on currency reserve weight vs target):
 * - Low Reserve (<85% of target): 200 BPS (2.00%) - discourage burns
 * - Normal (85-115% of target): 30 BPS (0.30%) - standard fee
 * - High Reserve (>115% of target): 5 BPS (0.05%) - encourage burns
 *
 * Spread:
 * - Default: 25 BPS (0.25%)
 */
import { config } from "../../config/env";
import { reserveTracker, ReserveTracker } from "../reserve/ReserveTracker";

/** Default spread in basis points (0.25% = 25 bps). */
const DEFAULT_SPREAD_BPS = Number(process.env.SPREAD_BPS || "25");

/** Base mint fee BPS (0.3% = 30). */
const BASE_MINT_FEE_BPS = 30;
/** Stressed mint fee BPS when reserves are low (0.5% = 50). */
const STRESSED_MINT_FEE_BPS = 50;
/** Maximum mint fee cap (1.0% = 100). */
const MAX_MINT_FEE_BPS = 100;

/** Base burn fee BPS for normal reserves (0.3% = 30). */
const BASE_BURN_FEE_BPS = 30;
/** Low reserve burn fee BPS - discourage burns when reserves are low (2% = 200). */
const LOW_RESERVE_BURN_FEE_BPS = 200;
/** High reserve burn fee BPS - encourage burns when reserves are high (0.05% = 5). */
const HIGH_RESERVE_BURN_FEE_BPS = 5;

/** Trigger high burn fee below 85% of target reserve weight. */
const LOW_RESERVE_THRESHOLD_PCT = 85;
/** Trigger low burn fee above 115% of target reserve weight. */
const HIGH_RESERVE_THRESHOLD_PCT = 115;
/** Float tolerance for reserve weight boundary checks. */
const RESERVE_THRESHOLD_EPSILON = 1e-9;

/** Sanity check: minimum fee in BPS (0.01% = 1). */
const MIN_SANITY_FEE_BPS = 1;
/** Sanity check: maximum fee in BPS (5% = 500). */
const MAX_SANITY_FEE_BPS = 500;

/**
 * Validate that a calculated fee is within sanity bounds.
 * @throws Error if fee is outside acceptable range
 */
function validateFeeSanity(feeBps: number, context: string): void {
  if (feeBps < MIN_SANITY_FEE_BPS || feeBps > MAX_SANITY_FEE_BPS) {
    throw new Error(
      `Fee sanity check failed for ${context}: ${feeBps} BPS is outside acceptable range [${MIN_SANITY_FEE_BPS}, ${MAX_SANITY_FEE_BPS}]`,
    );
  }
}

/**
 * Get spread in basis points (buy/sell spread for quote).
 */
export function getSpreadBps(): number {
  return DEFAULT_SPREAD_BPS;
}

/**
 * Get fee in basis points for mint. Fee increases when reserve ratio is low.
 *
 * Fee Structure:
 * - ratio >= minRatio (1.02): BASE_MINT_FEE_BPS (30 BPS)
 * - ratio < minRatio: STRESSED_MINT_FEE_BPS (50 BPS)
 * - Capped at MAX_MINT_FEE_BPS (100 BPS)
 */
export async function getMintFeeBps(_currency?: string): Promise<number> {
  const ratio = await reserveTracker.calculateReserveRatio(ReserveTracker.SEGMENT_TRANSACTIONS);

  let feeBps: number;
  if (ratio < config.reserve.minRatio) {
    feeBps = STRESSED_MINT_FEE_BPS;
  } else {
    feeBps = BASE_MINT_FEE_BPS;
  }

  // Apply cap
  feeBps = Math.min(feeBps, MAX_MINT_FEE_BPS);

  // Sanity check
  validateFeeSanity(feeBps, `mint (ratio: ${ratio.toFixed(4)})`);

  return feeBps;
}

/**
 * Get fee in basis points for burn (single-currency). Uses reserve weight vs target:
 * - Currency reserve < 85% of target → 200 BPS (discourage burns)
 * - Currency reserve 85-115% of target → 30 BPS (normal)
 * - Currency reserve > 115% of target → 5 BPS (encourage burns)
 *
 * This creates the correct economic incentive: when a currency is scarce in reserves,
 * we charge higher fees to discourage withdrawals. When abundant, we charge lower fees
 * to encourage rebalancing.
 */
export async function getBurnFeeBps(currency: string): Promise<number> {
  const status = await reserveTracker.getReserveStatus(ReserveTracker.SEGMENT_TRANSACTIONS);
  const curr = status.currencies.find((c) => c.currency === currency);

  if (!curr) {
    throw new Error(`Currency ${currency} not found in reserve status. Cannot calculate burn fee.`);
  }

  const targetWeight = curr.targetWeight;
  const actualWeight = curr.actualWeight;

  if (targetWeight <= 0) {
    throw new Error(
      `Invalid target weight for ${currency}: ${targetWeight}. Cannot calculate burn fee.`,
    );
  }

  const pctOfTarget = (actualWeight / targetWeight) * 100;

  let feeBps: number;
  if (pctOfTarget < LOW_RESERVE_THRESHOLD_PCT - RESERVE_THRESHOLD_EPSILON) {
    // Low reserves: discourage burns with high fee
    feeBps = LOW_RESERVE_BURN_FEE_BPS;
  } else if (pctOfTarget > HIGH_RESERVE_THRESHOLD_PCT + RESERVE_THRESHOLD_EPSILON) {
    // High reserves: encourage burns with low fee
    feeBps = HIGH_RESERVE_BURN_FEE_BPS;
  } else {
    // Normal reserves: standard fee
    feeBps = BASE_BURN_FEE_BPS;
  }

  // Sanity check
  validateFeeSanity(
    feeBps,
    `burn ${currency} (actual: ${actualWeight.toFixed(2)}%, target: ${targetWeight.toFixed(2)}%, ratio: ${pctOfTarget.toFixed(2)}%)`,
  );

  return feeBps;
}

/**
 * Apply spread to a mid rate: buy rate (user buys ACBU) and sell rate (user sells ACBU).
 * buyRate = mid * (1 - spread/2), sellRate = mid * (1 + spread/2).
 */
export function applySpread(midRate: number): {
  buyRate: number;
  sellRate: number;
} {
  const spread = DEFAULT_SPREAD_BPS / 10000;
  return {
    buyRate: midRate * (1 - spread / 2),
    sellRate: midRate * (1 + spread / 2),
  };
}
