/**
 * Deposit and withdrawal limits by audience (retail, business, government).
 * Aligned with LIMITS_AND_TIERS.MD.
 */
import type { Audience } from '../middleware/auth';
import { config } from './env';

export interface LimitConfig {
  depositDailyUsd: number;
  depositMonthlyUsd: number;
  withdrawalSingleCurrencyDailyUsd: number;
  withdrawalSingleCurrencyMonthlyUsd: number;
}

const LIMITS: Record<Audience, LimitConfig> = {
  retail: config.limits.retail,
  business: config.limits.business,
  government: config.limits.government,
};

export function getLimitConfig(audience: Audience): LimitConfig {
  return LIMITS[audience];
}

/** Circuit breaker: pause single-currency withdrawal if reserve below this % of target weight. */
export const CIRCUIT_BREAKER_RESERVE_WEIGHT_THRESHOLD_PCT = config.limits.circuitBreaker.reserveWeightThresholdPct;

/** Pause new minting if total reserve ratio below this (e.g. 1.02 = 102%). */
export const CIRCUIT_BREAKER_MIN_RESERVE_RATIO = config.limits.circuitBreaker.minReserveRatio;
