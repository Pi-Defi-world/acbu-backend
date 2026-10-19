/**
 * Limits and circuit breakers for deposit/withdrawal.
 * Enforces per-audience daily/monthly caps and reserve-based circuit breakers.
 */
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../../config/database";
import {
  getLimitConfig,
  getCircuitBreakerMinReserveRatio,
  getCircuitBreakerReserveWeightThresholdPct,
} from "../../config/limits";
import { reserveTracker, ReserveTracker } from "../reserve/ReserveTracker";
// import { basketService } from '../basket';
import type { Audience } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { getStartOfZonedDay, getStartOfZonedMonth } from "../../utils/dateUtils";
import { getAcbuUsdRate } from "../../utils/priceUtils";

function buildActorWhere(userId: string | null, organizationId: string | null) {
  if (userId) {
    return { userId };
  }

  if (organizationId) {
    return {
      OR: [
        // Org API-key transactions (userId=null, organizationId set on row).
        { organizationId },
        // Transactions from users belonging to this organization.
        { user: { organizationId } },
      ],
    };
  }

  return { userId: null };
}

/**
 * Sum the USD-equivalent value of deposits for the given actor since `since`.
 *
 * USDC deposits store their value in `usdcAmount`. Basket-currency deposits
 * (NGN/etc.) store `usdcAmount = null` and instead carry their USD-equivalent
 * value in `amountUsd`. Both must be counted so the deposit cap cannot be
 * bypassed by funding through non-USDC rails.
 */
async function sumDepositsUsdSince(
  since: Date,
  whereActor: ReturnType<typeof buildActorWhere>,
): Promise<Decimal> {
  const [usdcAgg, basketAgg] = await Promise.all([
    prisma.transaction.aggregate({
      where: {
        type: "mint",
        status: { in: ["pending", "processing", "completed"] },
        createdAt: { gte: since },
        ...whereActor,
      },
      _sum: { usdcAmount: true },
    }),
    prisma.transaction.aggregate({
      where: {
        type: "mint",
        status: { in: ["pending", "processing", "completed"] },
        createdAt: { gte: since },
        usdcAmount: null,
        ...whereActor,
      },
      _sum: { amountUsd: true },
    }),
  ]);

  return new Decimal(usdcAgg._sum.usdcAmount ?? 0).plus(
    new Decimal(basketAgg._sum.amountUsd ?? 0),
  );
}

/**
 * Check deposit limits for the given actor (userId or organizationId) and audience.
 * Throws AppError if limit exceeded.
 */
export async function checkDepositLimits(
  audience: Audience,
  amountUsd: Decimal,
  userId: string | null,
  organizationId: string | null,
): Promise<void> {
  const config = await getLimitConfig(audience);
  const now = new Date();
  const startOfDay = getStartOfZonedDay(now);
  const startOfMonth = getStartOfZonedMonth(now);

  const whereActor = buildActorWhere(userId, organizationId);

  // Include both USDC deposits (usdcAmount) and basket-currency deposits
  // (usdcAmount = null, USD-equivalent in amountUsd) in the rolling aggregate.
  const [mintedDailyUsd, mintedMonthlyUsd] = await Promise.all([
    sumDepositsUsdSince(startOfDay, whereActor),
    sumDepositsUsdSince(startOfMonth, whereActor),
  ]);

  const dailyUsd = mintedDailyUsd.plus(amountUsd);
  const monthlyUsd = mintedMonthlyUsd.plus(amountUsd);

  if (dailyUsd.greaterThan(config.depositDailyUsd)) {
    throw new AppError(
      `Deposit daily limit exceeded ($${config.depositDailyUsd}). Current 24h: $${dailyUsd.toFixed(2)}.`,
      429,
    );
  }
  if (monthlyUsd.greaterThan(config.depositMonthlyUsd)) {
    throw new AppError(
      `Deposit monthly limit exceeded ($${config.depositMonthlyUsd}). Current month: $${monthlyUsd.toFixed(2)}.`,
      429,
    );
  }
}

/**
 * Check withdrawal (single-currency burn) limits for the given actor and audience.
 *
 * The configured caps (`withdrawalSingleCurrencyDailyUsd` /
 * `withdrawalSingleCurrencyMonthlyUsd`) are denominated in USD, while the
 * aggregated burn amounts are ACBU units. Convert the ACBU amounts to their
 * USD-equivalent value before comparing so the limit is evaluated against the
 * correct magnitude.
 * Throws AppError if limit exceeded.
 */
export async function checkWithdrawalLimits(
  audience: Audience,
  amountAcbu: Decimal,
  currency: string,
  userId: string | null,
  organizationId: string | null,
): Promise<void> {
  const config = await getLimitConfig(audience);
  const now = new Date();
  const startOfDay = getStartOfZonedDay(now);
  const startOfMonth = getStartOfZonedMonth(now);

  const whereActor = buildActorWhere(userId, organizationId);
  const burnedDaily = await prisma.transaction.aggregate({
    where: {
      type: { in: ["burn", "bill_payment"] },
      localCurrency: currency,
      status: { in: ["pending", "processing", "completed"] },
      createdAt: { gte: startOfDay },
      ...whereActor,
    },
    _sum: { acbuAmountBurned: true },
  });
  const burnedMonthly = await prisma.transaction.aggregate({
    where: {
      type: { in: ["burn", "bill_payment"] },
      localCurrency: currency,
      status: { in: ["pending", "processing", "completed"] },
      createdAt: { gte: startOfMonth },
      ...whereActor,
    },
    _sum: { acbuAmountBurned: true },
  });

  const dailyAcbu = new Decimal(burnedDaily._sum.acbuAmountBurned ?? 0).plus(amountAcbu);
  const monthlyAcbu = new Decimal(burnedMonthly._sum.acbuAmountBurned ?? 0).plus(amountAcbu);

  // Convert ACBU amounts to USD-equivalent before comparing against the
  // USD-denominated withdrawal caps.
  const acbuUsdRate = await getAcbuUsdRate();
  const dailyUsd = dailyAcbu.mul(acbuUsdRate);
  const monthlyUsd = monthlyAcbu.mul(acbuUsdRate);

  if (dailyUsd.greaterThan(config.withdrawalSingleCurrencyDailyUsd)) {
    throw new AppError(
      `Withdrawal daily limit for ${currency} exceeded ($${config.withdrawalSingleCurrencyDailyUsd} equivalent).`,
      429,
    );
  }
  if (monthlyUsd.greaterThan(config.withdrawalSingleCurrencyMonthlyUsd)) {
    throw new AppError(
      `Withdrawal monthly limit for ${currency} exceeded ($${config.withdrawalSingleCurrencyMonthlyUsd} equivalent).`,
      429,
    );
  }
}

/**
 * Circuit breaker: return true if single-currency withdrawals for this currency are paused
 * (reserve below threshold % of target).
 */
export async function isCurrencyWithdrawalPaused(currency: string): Promise<boolean> {
  const status = await reserveTracker.getReserveStatus(ReserveTracker.SEGMENT_TRANSACTIONS);
  const curr = status.currencies.find((c) => c.currency === currency);
  if (!curr) return false;
  const targetWeight = curr.targetWeight;
  const actualWeight = curr.actualWeight;
  if (targetWeight <= 0) return false;
  const pctOfTarget = (actualWeight / targetWeight) * 100;
  return pctOfTarget < (await getCircuitBreakerReserveWeightThresholdPct());
}

/**
 * Circuit breaker: return true if new minting should be paused (reserve ratio below 102%).
 */
export async function isMintingPaused(): Promise<boolean> {
  const ratio = await reserveTracker.calculateReserveRatio(ReserveTracker.SEGMENT_TRANSACTIONS);
  return ratio < (await getCircuitBreakerMinReserveRatio());
}
