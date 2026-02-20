/**
 * Investment allocation: computes deployable amounts from investment/savings reserve segment
 * and vault/pool liquidity. Used to determine how much can be allocated to yield-bearing strategies.
 */
import { reserveTracker, ReserveTracker } from '../reserve/ReserveTracker';

/** Max fraction of investment_savings segment that can be deployed (0-1). Default 0.5. */
const DEPLOYABLE_FRACTION = Number(process.env.INVESTMENT_DEPLOYABLE_FRACTION || '0.5');

export interface AllocationSummary {
  segment: string;
  totalReserveValueUsd: number;
  deployableUsd: number;
  deployedUsd: number;
}

/**
 * Get total reserve value for the investment_savings segment (from ReserveTracker).
 */
export async function getInvestmentSavingsReserveValueUsd(): Promise<number> {
  const status = await reserveTracker.getReserveStatus(ReserveTracker.SEGMENT_INVESTMENT_SAVINGS);
  return status.totalReserveValueUsd;
}

/**
 * Compute deployable amount (USD) from investment/savings segment for yield strategies.
 * Policy: deployableUsd = totalReserveValueUsd * DEPLOYABLE_FRACTION (config).
 */
export async function computeDeployableAllocation(): Promise<AllocationSummary> {
  const totalReserveValueUsd = await getInvestmentSavingsReserveValueUsd();
  const deployableUsd = totalReserveValueUsd * Math.min(1, Math.max(0, DEPLOYABLE_FRACTION));
  return {
    segment: ReserveTracker.SEGMENT_INVESTMENT_SAVINGS,
    totalReserveValueUsd,
    deployableUsd,
    deployedUsd: 0, // TODO: track actual deployed amount when strategies are implemented
  };
}
