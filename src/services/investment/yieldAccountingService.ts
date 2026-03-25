/**
 * Yield accounting: track realized yield credits and provide source-level reporting.
 * This module keeps a normalized in-memory ledger for deterministic calculations.
 */
import { logger } from "../../config/logger";

export type YieldSource = "reserve" | "vault" | "pool";

export interface YieldCredit {
  source: YieldSource;
  amountUsd: number;
  currency?: string;
  timestamp: Date;
}

interface YieldLedgerEntry {
  source: YieldSource;
  amountUsd: number;
  currency?: string;
  timestamp: Date;
}

const yieldLedger: YieldLedgerEntry[] = [];
const MAX_LEDGER_ENTRIES = 10_000;

function normalizeAmountUsd(amountUsd: number): number {
  return Math.round(amountUsd * 1e8) / 1e8;
}

function isValidCurrencyCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

function assertValidCredit(credit: YieldCredit): void {
  if (!Number.isFinite(credit.amountUsd) || credit.amountUsd <= 0) {
    throw new Error("Yield amount must be a positive finite number");
  }
  if (Number.isNaN(credit.timestamp.getTime())) {
    throw new Error("Yield timestamp must be a valid Date");
  }
  if (
    credit.currency !== undefined &&
    !isValidCurrencyCode(credit.currency.toUpperCase())
  ) {
    throw new Error("Yield currency must be a 3-letter uppercase code");
  }
}

/**
 * Record yield for accounting (reserve segment or vault/pool).
 */
export function recordYield(credit: YieldCredit): void {
  assertValidCredit(credit);
  const normalized: YieldLedgerEntry = {
    source: credit.source,
    amountUsd: normalizeAmountUsd(credit.amountUsd),
    currency: credit.currency?.toUpperCase(),
    timestamp: new Date(credit.timestamp.getTime()),
  };
  yieldLedger.push(normalized);
  if (yieldLedger.length > MAX_LEDGER_ENTRIES) {
    yieldLedger.shift();
  }
  logger.info("Yield recorded", {
    source: normalized.source,
    amountUsd: normalized.amountUsd,
    currency: normalized.currency,
    timestamp: normalized.timestamp.toISOString(),
  });
}

/**
 * Get total yield recorded for a source (for reporting).
 */
export function getYieldTotal(source: YieldSource): number {
  return yieldLedger
    .filter((y) => y.source === source)
    .reduce((sum, y) => sum + y.amountUsd, 0);
}

/**
 * Return source totals for quick reporting dashboards.
 */
export function getYieldTotals(): Record<YieldSource, number> {
  return {
    reserve: getYieldTotal("reserve"),
    vault: getYieldTotal("vault"),
    pool: getYieldTotal("pool"),
  };
}
