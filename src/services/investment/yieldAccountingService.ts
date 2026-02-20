/**
 * Yield accounting: track interest/yield per source (reserve vs vault/pool) and distribute per business rules.
 * Stub for now; will credit reserve and vault APY when yield is received.
 */
import { logger } from '../../config/logger';

export interface YieldCredit {
  source: 'reserve' | 'vault' | 'pool';
  amountUsd: number;
  currency?: string;
  timestamp: Date;
}

const yieldLedger: YieldCredit[] = [];

/**
 * Record yield for accounting (reserve segment or vault/pool).
 */
export function recordYield(credit: YieldCredit): void {
  yieldLedger.push(credit);
  logger.info('Yield recorded', { source: credit.source, amountUsd: credit.amountUsd });
}

/**
 * Get total yield recorded for a source (for reporting).
 */
export function getYieldTotal(source: 'reserve' | 'vault' | 'pool'): number {
  return yieldLedger.filter((y) => y.source === source).reduce((s, y) => s + y.amountUsd, 0);
}
