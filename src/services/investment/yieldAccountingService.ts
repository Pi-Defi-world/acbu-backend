/**
 * Yield accounting: track realized yield credits and provide source-level reporting.
 * This module keeps a normalized in-memory ledger for deterministic calculations.
 */
import { logger } from "../../config/logger";
import { prisma } from "../../config/database";
import { Decimal } from "@prisma/client/runtime/library";

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
  if (credit.currency !== undefined && !isValidCurrencyCode(credit.currency.toUpperCase())) {
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
  return yieldLedger.filter((y) => y.source === source).reduce((sum, y) => sum + y.amountUsd, 0);
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

/**
 * Compute accruals from deployed strategy notional and record as yield postings.
 * - Uses `investmentStrategy.deployedNotionalUsd` and `targetApyBps`.
 * - Accrual formula (pro-rate by days in period): amount = principal * (apy/100) * (days/365)
 * This implementation computes accrual for a single day (pro-rated) when called without
 * a `days` argument; callers may pass the number of days in the accrual period.
 */
export async function accrueFromStrategies(days = 1, asOf: Date = new Date()): Promise<void> {
  try {
    const strategies = await prisma.investmentStrategy.findMany({ where: { status: "active" } });

    for (const s of strategies) {
      // targetApyBps is nullable (Int?) — guard against null/undefined explicitly
      if (s.targetApyBps == null || s.targetApyBps <= 0) continue;
      // deployedNotionalUsd is a non-nullable Decimal with DB default 0; read directly
      const principal = s.deployedNotionalUsd;
      if (principal.lte(0)) continue;

      const apy = new Decimal(s.targetApyBps).div(10000); // bps -> decimal (e.g., 250 -> 0.025)
      const daysDecimal = new Decimal(days);
      const accrual = principal.mul(apy).mul(daysDecimal).div(365);

      const amountUsd = Number(accrual.toFixed(8));
      if (!Number.isFinite(amountUsd) || amountUsd <= 0) continue;

      // Record as 'vault' yield (accrual tied to deployed strategy / vault positions)
      recordYield({
        source: "vault",
        amountUsd,
        timestamp: new Date(asOf.getTime()),
      });

      // Persist an accrual posting so statement APIs and audits can report yield.
      // We record this as a completed `accrual` transaction with a JSON `rateSnapshot`
      // marker so downstream consumers can identify and aggregate accruals.
      try {
        await prisma.transaction.create({
          data: {
            type: "accrual",
            status: "completed",
            usdcAmount: new Decimal(amountUsd),
            // Attach strategy id and source for discoverability in JSON
            rateSnapshot: {
              source: "yield_accrual",
              strategyId: s.id,
            },
            completedAt: new Date(asOf.getTime()),
          },
        });
      } catch (e) {
        // Log and continue; accruals should not block the scheduler on transient DB errors.
        logger.error("Failed to persist accrual transaction", e);
      }
    }
  } catch (err) {
    logger.error("Failed to accrue yields from strategies", err);
    throw err;
  }
}
