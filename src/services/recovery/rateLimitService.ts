/**
 * Rate limiting service for recovery attempts
 * Prevents brute force attacks and limits recovery attempts
 */
import { prisma } from "../../config/database";
import { logger } from "../../config/logger";

export interface RecoveryRateLimitResult {
  allowed: boolean;
  remainingAttempts: number;
  resetTime?: Date;
  reason?: string;
}

const RATE_LIMITS = {
  // Per identifier (email/phone) limits
  identifier: {
    maxAttempts: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
  },
  // Per IP limits
  ip: {
    maxAttempts: 10,
    windowMs: 60 * 60 * 1000, // 1 hour
  },
  // Per user limits
  user: {
    maxAttempts: 3,
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
  },
};

/**
 * Check if recovery attempt is allowed based on rate limits
 */
export async function checkRecoveryRateLimit(
  identifier: string,
  userId?: string,
  ip?: string,
): Promise<RecoveryRateLimitResult> {
  const now = new Date();

  // Check identifier-based rate limit
  const identifierAttempts = await prisma.recoveryAttempt.count({
    where: {
      identifier,
      createdAt: {
        gte: new Date(now.getTime() - RATE_LIMITS.identifier.windowMs),
      },
    },
  });

  if (identifierAttempts >= RATE_LIMITS.identifier.maxAttempts) {
    const resetTime = new Date(now.getTime() + RATE_LIMITS.identifier.windowMs);
    return {
      allowed: false,
      remainingAttempts: 0,
      resetTime,
      reason: "Too many attempts for this identifier. Please try again later.",
    };
  }

  // Check IP-based rate limit
  if (ip) {
    const ipAttempts = await prisma.recoveryAttempt.count({
      where: {
        ip,
        createdAt: { gte: new Date(now.getTime() - RATE_LIMITS.ip.windowMs) },
      },
    });

    if (ipAttempts >= RATE_LIMITS.ip.maxAttempts) {
      const resetTime = new Date(now.getTime() + RATE_LIMITS.ip.windowMs);
      return {
        allowed: false,
        remainingAttempts: 0,
        resetTime,
        reason:
          "Too many attempts from this IP address. Please try again later.",
      };
    }
  }

  // Check user-based rate limit
  if (userId) {
    const userAttempts = await prisma.recoveryAttempt.count({
      where: {
        userId,
        createdAt: { gte: new Date(now.getTime() - RATE_LIMITS.user.windowMs) },
      },
    });

    if (userAttempts >= RATE_LIMITS.user.maxAttempts) {
      const resetTime = new Date(now.getTime() + RATE_LIMITS.user.windowMs);
      return {
        allowed: false,
        remainingAttempts: 0,
        resetTime,
        reason:
          "Too many recovery attempts for this account. Please contact support.",
      };
    }
  }

  // Calculate remaining attempts for identifier
  const remainingIdentifier =
    RATE_LIMITS.identifier.maxAttempts - identifierAttempts;

  return {
    allowed: true,
    remainingAttempts: remainingIdentifier,
  };
}

/**
 * Record a recovery attempt
 */
export async function recordRecoveryAttempt(
  userId: string,
  identifier: string,
  success: boolean,
  reason?: string,
  ip?: string,
  userAgent?: string,
): Promise<void> {
  await prisma.recoveryAttempt.create({
    data: {
      userId,
      identifier,
      success,
      reason,
      ip,
      userAgent,
    },
  });

  logger.info("Recovery attempt recorded", {
    userId,
    identifier: identifier.includes("@")
      ? "***@***"
      : identifier.slice(0, 6) + "***",
    success,
    reason,
    hasIp: !!ip,
  });
}

/**
 * Clean up old recovery attempt records
 */
export async function cleanupOldRecoveryAttempts(): Promise<void> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const deletedCount = await prisma.recoveryAttempt.deleteMany({
    where: {
      createdAt: { lt: thirtyDaysAgo },
    },
  });

  logger.info("Cleaned up old recovery attempts", {
    deletedCount: deletedCount.count,
  });
}

/**
 * Get recovery attempt statistics for monitoring
 */
export async function getRecoveryStats(
  timeframeMs: number = 24 * 60 * 60 * 1000,
): Promise<{
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  uniqueUsers: number;
  uniqueIdentifiers: number;
}> {
  const since = new Date(Date.now() - timeframeMs);

  const [total, successful, uniqueUsers, uniqueIdentifiers] = await Promise.all(
    [
      prisma.recoveryAttempt.count({
        where: { createdAt: { gte: since } },
      }),
      prisma.recoveryAttempt.count({
        where: {
          createdAt: { gte: since },
          success: true,
        },
      }),
      prisma.recoveryAttempt.findMany({
        where: { createdAt: { gte: since } },
        select: { userId: true },
        distinct: ["userId"],
      }),
      prisma.recoveryAttempt.findMany({
        where: { createdAt: { gte: since } },
        select: { identifier: true },
        distinct: ["identifier"],
      }),
    ],
  );

  return {
    totalAttempts: total,
    successfulAttempts: successful,
    failedAttempts: total - successful,
    uniqueUsers: uniqueUsers.length,
    uniqueIdentifiers: uniqueIdentifiers.length,
  };
}
