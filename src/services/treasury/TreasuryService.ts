/**
 * Treasury Service: Robust join-and-reconcile logic for treasury calculations.
 *
 * This service implements:
 * 1. Data joins across Transfers (transactions), Reserves, and FX Snapshots
 * 2. Null handling (COALESCE-like logic) for missing data points
 * 3. FX Fallback: use most recent rate if current snapshot missing
 * 4. Reconciliation Engine: verify totals against ledger with tolerance
 * 5. Tolerance Logic: Allow 0.01% discrepancy, log warnings if exceeded
 *
 * Source of Truth Hierarchy:
 * 1. Ledger (Reserves) - authoritative balance
 * 2. Calculated Total (Transfers) - derived from transactions
 * 3. Discrepancy - logged as warning if exceeds tolerance
 */

import { prismaReplica } from "../../config/database";
import { logger } from "../../config/logger";
import { ReserveTracker } from "../reserve/ReserveTracker";
import { getLatestReserves } from "../reports/reportService";

// Constants
const DEFAULT_TOLERANCE_PERCENTAGE = 0.01; // 0.01%
const DAYS_FOR_FX_FALLBACK = 7; // Look back 7 days for FX fallback

type DecimalLike = { toString: () => string } | null | undefined;

interface TransactionAggregate {
  currency: string;
  totalMintedUsd: number;
  totalBurnedUsd: number;
  netTransferredUsd: number;
  transactionCount: number;
}

interface ReserveSnapshot {
  currency: string;
  segment: string;
  amount: number;
  valueUsd: number;
  timestamp: Date;
}

interface FxRate {
  currency: string;
  rateUsd: number;
  timestamp: Date;
  source: "current" | "fallback";
}

interface TreasurySegment {
  currency: string;
  segment: string;
  reserveAmount: number; // Current holding in local currency
  reserveValueUsd: number; // Current holding in USD
  fxRate: number; // Exchange rate used
  fxRateTimestamp: Date; // When FX rate was captured
  fxRateSource: "current" | "fallback" | "zero"; // Source of FX rate
}

interface ReconciliationResult {
  ledgerTotal: number;
  calculatedTotal: number;
  discrepancy: number;
  discrepancyPercentage: number;
  isReconciled: boolean;
  tolerancePercentage: number;
  warnings: string[];
}

interface TreasuryBySegment {
  currency: string;
  targetWeight: number | null;
  transactions: TreasurySegment;
  investmentSavings: TreasurySegment;
  combined: {
    reserveAmount: number;
    reserveValueUsd: number;
  };
}

interface EnterpriseTreasuryResult {
  totalBalanceUsd: number;
  totalReserveAmount: number;
  summary: {
    transactionsSegmentUsd: number;
    investmentSavingsSegmentUsd: number;
  };
  byCurrency: TreasuryBySegment[];
  reconciliation: ReconciliationResult;
  message: string;
}

/**
 * Convert exact Decimal values at this reporting boundary only.
 *
 * Do not call Prisma Decimal#toNumber() directly in settlement logic; keep exact
 * values as Decimal/string until a numeric API response is explicitly required.
 */
function decimalToNumber(value: DecimalLike): number {
  return Number(value?.toString() ?? "0");
}

/**
 * Get the most recent FX rate for a currency, with fallback logic
 */
async function getFxRateWithFallback(currency: string): Promise<FxRate | null> {
  // Try to get the most recent rate
  const currentRate = await prismaReplica.oracleRate.findFirst({
    where: { currency },
    orderBy: { timestamp: "desc" },
    select: { rateUsd: true, timestamp: true },
  });

  if (currentRate) {
    return {
      currency,
      rateUsd: decimalToNumber(currentRate.rateUsd),
      timestamp: currentRate.timestamp,
      source: "current",
    };
  }

  // Fallback: look for any rate within the last DAYS_FOR_FX_FALLBACK days
  const fallbackDate = new Date(Date.now() - DAYS_FOR_FX_FALLBACK * 24 * 60 * 60 * 1000);
  const fallbackRate = await prismaReplica.oracleRate.findFirst({
    where: {
      currency,
      timestamp: { gte: fallbackDate },
    },
    orderBy: { timestamp: "desc" },
    select: { rateUsd: true, timestamp: true },
  });

  if (fallbackRate) {
    logger.warn("Using fallback FX rate for currency", {
      currency,
      daysOld: Math.floor((Date.now() - fallbackRate.timestamp.getTime()) / (24 * 60 * 60 * 1000)),
    });
    return {
      currency,
      rateUsd: decimalToNumber(fallbackRate.rateUsd),
      timestamp: fallbackRate.timestamp,
      source: "fallback",
    };
  }

  logger.warn("No FX rate available for currency (using 0)", { currency });
  return null;
}

/**
 * Aggregate transaction data by currency
 */
async function aggregateTransactionsBySegment(): Promise<Map<string, TransactionAggregate>> {
  const transactions = await prismaReplica.transaction.findMany({
    where: {
      status: { in: ["completed", "processing"] },
      type: { in: ["mint", "burn", "transfer"] },
    },
    take: 50_000, // #437: cap to prevent OOM on large tables
    select: {
      type: true,
      localCurrency: true,
      usdcAmount: true,
    },
  });

  const aggregates = new Map<string, TransactionAggregate>();

  for (const tx of transactions) {
    const currency = tx.localCurrency || "UNKNOWN";

    // Skip if currency is not set
    if (!tx.localCurrency) continue;

    const existing = aggregates.get(currency) ?? {
      currency,
      totalMintedUsd: 0,
      totalBurnedUsd: 0,
      netTransferredUsd: 0,
      transactionCount: 0,
    };

    if (tx.type === "mint") {
      existing.totalMintedUsd += decimalToNumber(tx.usdcAmount);
    } else if (tx.type === "burn") {
      existing.totalBurnedUsd += decimalToNumber(tx.usdcAmount);
    } else if (tx.type === "transfer") {
      existing.netTransferredUsd += decimalToNumber(tx.usdcAmount);
    }

    existing.transactionCount += 1;
    aggregates.set(currency, existing);
  }

  return aggregates;
}

/**
 * Get latest reserves by currency and segment with null handling (COALESCE logic)
 */
async function getLatestReservesBySegment(): Promise<Map<string, ReserveSnapshot>> {
  const reserves = await getLatestReserves();

  const reserveMap = new Map<string, ReserveSnapshot>();

  for (const reserve of reserves) {
    const key = `${reserve.currency}:${reserve.segment}`;
    reserveMap.set(key, {
      currency: reserve.currency,
      segment: reserve.segment,
      amount: decimalToNumber(reserve.reserveAmount),
      valueUsd: decimalToNumber(reserve.reserveValueUsd),
      timestamp: reserve.timestamp,
    });
  }

  return reserveMap;
}

/**
 * Reconcile calculated total against ledger total with tolerance
 */
function reconcileTotals(
  ledgerTotalUsd: number,
  calculatedTotalUsd: number,
  tolerancePercentage: number = DEFAULT_TOLERANCE_PERCENTAGE,
): ReconciliationResult {
  const discrepancy = Math.abs(ledgerTotalUsd - calculatedTotalUsd);
  const discrepancyPercentage = ledgerTotalUsd > 0 ? (discrepancy / ledgerTotalUsd) * 100 : 0;

  const isReconciled = discrepancyPercentage <= tolerancePercentage;
  const warnings: string[] = [];

  if (!isReconciled) {
    const warningMsg = `Treasury reconciliation FAILED: Ledger Total USD ${ledgerTotalUsd.toFixed(
      2,
    )} vs Calculated Total USD ${calculatedTotalUsd.toFixed(2)}, discrepancy ${discrepancyPercentage.toFixed(
      4,
    )}% (tolerance: ${tolerancePercentage}%)`;
    warnings.push(warningMsg);
    logger.error(warningMsg);
  } else if (discrepancy > 0) {
    const warningMsg = `Treasury within tolerance: discrepancy ${discrepancyPercentage.toFixed(
      4,
    )}% (threshold: ${tolerancePercentage}%)`;
    warnings.push(warningMsg);
    logger.warn(warningMsg);
  }

  return {
    ledgerTotal: ledgerTotalUsd,
    calculatedTotal: calculatedTotalUsd,
    discrepancy,
    discrepancyPercentage,
    isReconciled,
    tolerancePercentage,
    warnings,
  };
}

/**
 * Build treasury segment details (with FX fallback handling)
 */
async function buildTreasurySegment(
  currency: string,
  segment: string,
  reserve: ReserveSnapshot | null,
): Promise<TreasurySegment> {
  const reserveAmount = reserve?.amount ?? 0;
  const reserveValueUsd = reserve?.valueUsd ?? 0;

  if (!reserve) {
    return {
      currency,
      segment,
      reserveAmount,
      reserveValueUsd,
      fxRate: 1,
      fxRateTimestamp: new Date(),
      fxRateSource: "zero",
    };
  }

  let fxRate = 1;
  let fxRateTimestamp = new Date();
  let fxRateSource: "current" | "fallback" | "zero" = "zero";

  // Get FX rate with fallback logic
  const fxData = await getFxRateWithFallback(currency);
  if (fxData) {
    fxRate = fxData.rateUsd;
    fxRateTimestamp = fxData.timestamp;
    fxRateSource = fxData.source;
  } else {
    // If even fallback fails, use rate of 1 (no conversion)
    logger.warn(`No FX rate available for ${currency}, using rate=1`);
    fxRateSource = "zero";
  }

  return {
    currency,
    segment,
    reserveAmount,
    reserveValueUsd,
    fxRate,
    fxRateTimestamp,
    fxRateSource,
  };
}

/**
 * Main: Get enterprise treasury with full reconciliation
 */
export async function getEnterpriseTreasury(
  organizationId?: string,
  tolerancePercentage: number = DEFAULT_TOLERANCE_PERCENTAGE,
): Promise<EnterpriseTreasuryResult> {
  logger.info("Starting treasury calculation", {
    organizationId,
    tolerancePercentage,
  });

  try {
    // Fetch all data in parallel
    const [reservesBySegment, txAggregates] = await Promise.all([
      getLatestReservesBySegment(),
      aggregateTransactionsBySegment(),
    ]);

    // Collect all unique currencies
    const currencySet = new Set<string>();
    for (const key of reservesBySegment.keys()) {
      const [currency] = key.split(":");
      currencySet.add(currency);
    }
    for (const currency of txAggregates.keys()) {
      currencySet.add(currency);
    }

    const currencies = Array.from(currencySet).sort();

    let totalBalanceUsd = 0;
    let totalReserveAmount = 0;
    let transactionsSegmentUsd = 0;
    let investmentSavingsSegmentUsd = 0;

    const byCurrency: TreasuryBySegment[] = [];

    // Build treasury for each currency
    for (const currency of currencies) {
      const txReserve =
        reservesBySegment.get(`${currency}:${ReserveTracker.SEGMENT_TRANSACTIONS}`) ?? null;
      const invReserve =
        reservesBySegment.get(`${currency}:${ReserveTracker.SEGMENT_INVESTMENT_SAVINGS}`) ?? null;

      const [transactionsSegment, investmentSavingsSegment] = await Promise.all([
        buildTreasurySegment(currency, ReserveTracker.SEGMENT_TRANSACTIONS, txReserve),
        buildTreasurySegment(currency, ReserveTracker.SEGMENT_INVESTMENT_SAVINGS, invReserve),
      ]);

      const combined = {
        reserveAmount: transactionsSegment.reserveAmount + investmentSavingsSegment.reserveAmount,
        reserveValueUsd:
          transactionsSegment.reserveValueUsd + investmentSavingsSegment.reserveValueUsd,
      };

      totalBalanceUsd += combined.reserveValueUsd;
      totalReserveAmount += combined.reserveAmount;
      transactionsSegmentUsd += transactionsSegment.reserveValueUsd;
      investmentSavingsSegmentUsd += investmentSavingsSegment.reserveValueUsd;

      byCurrency.push({
        currency,
        targetWeight: null, // Can be enhanced with basket config
        transactions: transactionsSegment,
        investmentSavings: investmentSavingsSegment,
        combined,
      });
    }

    // Reconciliation: ledger USD reserves vs calculated USD transaction values.
    const calculatedTotalUsd = Array.from(txAggregates.values()).reduce(
      (sum, tx) => sum + tx.totalMintedUsd - tx.totalBurnedUsd + tx.netTransferredUsd,
      0,
    );
    const reconciliation = reconcileTotals(
      totalBalanceUsd,
      calculatedTotalUsd,
      tolerancePercentage,
    );

    const result: EnterpriseTreasuryResult = {
      totalBalanceUsd,
      totalReserveAmount,
      summary: {
        transactionsSegmentUsd,
        investmentSavingsSegmentUsd,
      },
      byCurrency,
      reconciliation,
      message: reconciliation.isReconciled
        ? "Treasury reconciliation successful"
        : "Treasury reconciliation failed - see warnings in reconciliation section",
    };

    logger.info("Treasury calculation completed", {
      totalBalanceUsd,
      reconciled: reconciliation.isReconciled,
    });

    return result;
  } catch (error) {
    logger.error("Treasury calculation failed", { error });
    throw error;
  }
}

/**
 * Health check: Return basic treasury health status
 */
export async function getTreasuryHealth(): Promise<{
  healthy: boolean;
  totalBalanceUsd: number;
  lastUpdated: Date;
  warnings: string[];
}> {
  try {
    const result = await getEnterpriseTreasury();
    return {
      healthy: result.reconciliation.isReconciled,
      totalBalanceUsd: result.totalBalanceUsd,
      lastUpdated: new Date(),
      warnings: result.reconciliation.warnings,
    };
  } catch (error) {
    logger.error("Treasury health check failed", { error });
    return {
      healthy: false,
      totalBalanceUsd: 0,
      lastUpdated: new Date(),
      warnings: ["Treasury health check failed - see server logs"],
    };
  }
}

export const treasuryService = {
  getEnterpriseTreasury,
  getTreasuryHealth,
};
