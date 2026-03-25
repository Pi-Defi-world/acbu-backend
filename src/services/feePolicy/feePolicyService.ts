/**
 * Fee policy: dynamic fees based on reserve levels (and optional demand).
 * Spread: buy/sell spread for rates/quote (0.2–0.3%).
 */
import { config } from "../../config/env";
import { reserveTracker, ReserveTracker } from "../reserve/ReserveTracker";

/** Default spread in basis points (0.25% = 25 bps). */
const DEFAULT_SPREAD_BPS = Number(process.env.SPREAD_BPS || "25");

/** Base mint fee BPS (0.3% = 30). */
const BASE_MINT_FEE_BPS = 30;
/** Base burn fee BPS (0.1% = 10). */
const BASE_BURN_FEE_BPS = 10;

/** When reserve weight is below target by this ratio, increase burn fee. */
const LOW_RESERVE_BURN_FEE_BPS = 200; // 2%
/** When reserve weight is above target, reduce burn fee. */
const HIGH_RESERVE_BURN_FEE_BPS = 10; // 0.1%
/** Trigger high burn fee below 85% of target reserve weight. */
const LOW_RESERVE_THRESHOLD_PCT = 85;
/** Trigger low burn fee above 115% of target reserve weight. */
const HIGH_RESERVE_THRESHOLD_PCT = 115;

/**
 * Get spread in basis points (buy/sell spread for quote).
 */
export function getSpreadBps(): number {
  return DEFAULT_SPREAD_BPS;
}

/**
 * Get fee in basis points for mint. Can be extended with reserve/demand logic.
 */
export async function getMintFeeBps(_currency?: string): Promise<number> {
  const paused = await reserveTracker.calculateReserveRatio(
    ReserveTracker.SEGMENT_TRANSACTIONS,
  );
  if (paused < config.reserve.minRatio) {
    return Math.min(100, BASE_MINT_FEE_BPS + 20); // slightly higher when ratio low
  }
  return BASE_MINT_FEE_BPS;
}

/**
 * Get fee in basis points for burn (single-currency). Uses reserve weight vs target:
 * if currency reserve below target → higher fee; above target → lower fee.
 */
export async function getBurnFeeBps(currency: string): Promise<number> {
  const status = await reserveTracker.getReserveStatus(
    ReserveTracker.SEGMENT_TRANSACTIONS,
  );
  const curr = status.currencies.find((c) => c.currency === currency);
  if (!curr) return BASE_BURN_FEE_BPS;
  const targetWeight = curr.targetWeight;
  const actualWeight = curr.actualWeight;
  if (targetWeight <= 0) return BASE_BURN_FEE_BPS;
  const pctOfTarget = (actualWeight / targetWeight) * 100;
  if (pctOfTarget < LOW_RESERVE_THRESHOLD_PCT) return LOW_RESERVE_BURN_FEE_BPS;
  if (pctOfTarget > HIGH_RESERVE_THRESHOLD_PCT)
    return HIGH_RESERVE_BURN_FEE_BPS;
  return BASE_BURN_FEE_BPS;
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
