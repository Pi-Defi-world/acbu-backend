/**
 * Limits and circuit breakers for deposit/withdrawal.
 * Enforces per-audience daily/monthly caps and reserve-based circuit breakers.
 */
import { prisma } from "../../config/database";
import {
  getLimitConfig,
  CIRCUIT_BREAKER_RESERVE_WEIGHT_THRESHOLD_PCT,
  CIRCUIT_BREAKER_MIN_RESERVE_RATIO,
} from "../../config/limits";
import { reserveTracker, ReserveTracker } from "../reserve/ReserveTracker";
// import { basketService } from '../basket';
import type { Audience } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";

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
 * Check deposit limits for the given actor (userId or organizationId) and audience.
 * Throws AppError if limit exceeded.
 */
export async function checkDepositLimits(
  audience: Audience,
  amountUsd: number,
  userId: string | null,
  organizationId: string | null,
): Promise<void> {
  const config = getLimitConfig(audience);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const startOfMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  );

  const whereActor = buildActorWhere(userId, organizationId);
  const mintedDaily = await prisma.transaction.aggregate({
    where: {
      type: "mint",
      status: { in: ["pending", "processing", "completed"] },
      createdAt: { gte: since24h },
      ...whereActor,
    },
    _sum: { usdcAmount: true },
  });
  const mintedMonthly = await prisma.transaction.aggregate({
    where: {
      type: "mint",
      status: { in: ["pending", "processing", "completed"] },
      createdAt: { gte: startOfMonth },
      ...whereActor,
    },
    _sum: { usdcAmount: true },
  });

  // For basket-currency deposits we may not have usdcAmount; use localAmount converted to USD if needed.
  // Simplified: use amountUsd passed in (caller should pass USD equivalent).
  const dailyUsd = (mintedDaily._sum.usdcAmount?.toNumber() ?? 0) + amountUsd;
  const monthlyUsd =
    (mintedMonthly._sum.usdcAmount?.toNumber() ?? 0) + amountUsd;

  if (dailyUsd > config.depositDailyUsd) {
    throw new AppError(
      `Deposit daily limit exceeded ($${config.depositDailyUsd}). Current 24h: $${dailyUsd.toFixed(2)}.`,
      429,
    );
  }
  if (monthlyUsd > config.depositMonthlyUsd) {
    throw new AppError(
      `Deposit monthly limit exceeded ($${config.depositMonthlyUsd}). Current month: $${monthlyUsd.toFixed(2)}.`,
      429,
    );
  }
}

/**
 * Check withdrawal (single-currency burn) limits for the given actor and audience.
 * Uses ACBU amounts (limits doc USD values treated as ACBU-equivalent for comparison when rate not applied).
 * Throws AppError if limit exceeded.
 */
export async function checkWithdrawalLimits(
  audience: Audience,
  amountAcbu: number,
  currency: string,
  userId: string | null,
  organizationId: string | null,
): Promise<void> {
  const config = getLimitConfig(audience);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const startOfMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  );

  const whereActor = buildActorWhere(userId, organizationId);
  const burnedDaily = await prisma.transaction.aggregate({
    where: {
      type: { in: ["burn", "bill_payment"] },
      localCurrency: currency,
      status: { in: ["pending", "processing", "completed"] },
      createdAt: { gte: since24h },
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

  const dailyAcbu =
    (burnedDaily._sum.acbuAmountBurned?.toNumber() ?? 0) + amountAcbu;
  const monthlyAcbu =
    (burnedMonthly._sum.acbuAmountBurned?.toNumber() ?? 0) + amountAcbu;

  if (dailyAcbu > config.withdrawalSingleCurrencyDailyUsd) {
    throw new AppError(
      `Withdrawal daily limit for ${currency} exceeded ($${config.withdrawalSingleCurrencyDailyUsd} equivalent).`,
      429,
    );
  }
  if (monthlyAcbu > config.withdrawalSingleCurrencyMonthlyUsd) {
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
export async function isCurrencyWithdrawalPaused(
  currency: string,
): Promise<boolean> {
  const status = await reserveTracker.getReserveStatus(
    ReserveTracker.SEGMENT_TRANSACTIONS,
  );
  const curr = status.currencies.find((c) => c.currency === currency);
  if (!curr) return false;
  const targetWeight = curr.targetWeight;
  const actualWeight = curr.actualWeight;
  if (targetWeight <= 0) return false;
  const pctOfTarget = (actualWeight / targetWeight) * 100;
  return pctOfTarget < CIRCUIT_BREAKER_RESERVE_WEIGHT_THRESHOLD_PCT;
}

/**
 * Circuit breaker: return true if new minting should be paused (reserve ratio below 102%).
 */
export async function isMintingPaused(): Promise<boolean> {
  const ratio = await reserveTracker.calculateReserveRatio(
    ReserveTracker.SEGMENT_TRANSACTIONS,
  );
  return ratio < CIRCUIT_BREAKER_MIN_RESERVE_RATIO;
}
