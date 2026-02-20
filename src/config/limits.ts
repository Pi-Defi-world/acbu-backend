/**
 * Deposit and withdrawal limits by audience (retail, business, government).
 * Aligned with LIMITS_AND_TIERS.MD.
 */
import type { Audience } from '../middleware/auth';

export interface LimitConfig {
  depositDailyUsd: number;
  depositMonthlyUsd: number;
  withdrawalSingleCurrencyDailyUsd: number;
  withdrawalSingleCurrencyMonthlyUsd: number;
}

const LIMITS: Record<Audience, LimitConfig> = {
  retail: {
    depositDailyUsd: 5_000,
    depositMonthlyUsd: 50_000,
    withdrawalSingleCurrencyDailyUsd: 10_000,
    withdrawalSingleCurrencyMonthlyUsd: 80_000,
  },
  business: {
    depositDailyUsd: 50_000,
    depositMonthlyUsd: 500_000,
    withdrawalSingleCurrencyDailyUsd: 100_000,
    withdrawalSingleCurrencyMonthlyUsd: 800_000,
  },
  government: {
    depositDailyUsd: 500_000,
    depositMonthlyUsd: 5_000_000,
    withdrawalSingleCurrencyDailyUsd: 500_000,
    withdrawalSingleCurrencyMonthlyUsd: 4_000_000,
  },
};

export function getLimitConfig(audience: Audience): LimitConfig {
  return LIMITS[audience];
}

/** Circuit breaker: pause single-currency withdrawal if reserve below this % of target weight. */
export const CIRCUIT_BREAKER_RESERVE_WEIGHT_THRESHOLD_PCT = 10;

/** Pause new minting if total reserve ratio below this (e.g. 1.02 = 102%). */
export const CIRCUIT_BREAKER_MIN_RESERVE_RATIO = 1.02;
