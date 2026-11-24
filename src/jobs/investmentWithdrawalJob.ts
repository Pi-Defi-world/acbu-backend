/**
 * Investment withdrawal job: at T+24h mark requests as 'available' and send "investment withdrawal ready" notification.
 */
import { prisma } from "../config/database";
import { logger } from "../config/logger";
import { publishInvestmentWithdrawalReady } from "../services/investment/withdrawalNotificationService";
import {
  getReadyInvestmentWithdrawalBatch,
  READY_WITHDRAWAL_STATUSES,
} from "../services/investment/withdrawalTimingService";
import { retryWithBackoff } from "../utils/retry";
import { decimalToNumber } from "../utils/decimalUtils";

export async function processInvestmentWithdrawalAvailability(): Promise<void> {
  const { trustedNow, records } = await getReadyInvestmentWithdrawalBatch();
  for (const r of records) {
    try {
      const transition = await retryWithBackoff<{ count: number }>(
        () =>
          prisma.investmentWithdrawalRequest.updateMany({
            where: {
              id: r.id,
              status: { in: [...READY_WITHDRAWAL_STATUSES] },
              availableAt: { lte: trustedNow },
            },
            data: { status: "available", notifiedAt: trustedNow },
          }),
        {
          attempts: 3,
          initialDelayMs: 100,
          onRetry: (error, attempt, delayMs) =>
            logger.warn("Retrying investment withdrawal update", {
              requestId: r.id,
              attempt,
              delayMs,
              error,
            }),
        },
      );
      if (transition.count === 0) {
        logger.info("Investment withdrawal already processed or no longer ready", {
          requestId: r.id,
        });
        continue;
      }

      const amountAcbu = decimalToNumber(r.amountAcbu);
      if (r.userId || r.organizationId) {
        await retryWithBackoff(
          () =>
            publishInvestmentWithdrawalReady(r.userId, amountAcbu, r.organizationId, trustedNow),
          {
            attempts: 3,
            initialDelayMs: 100,
            onRetry: (error, attempt, delayMs) =>
              logger.warn("Retrying investment withdrawal notification", {
                requestId: r.id,
                attempt,
                delayMs,
                error,
              }),
          },
        );
      }
      logger.info("Investment withdrawal marked available and notified", {
        requestId: r.id,
        userId: r.userId,
        organizationId: r.organizationId,
        amountAcbu,
      });
    } catch (e) {
      logger.error("Investment withdrawal job failed for request", {
        requestId: r.id,
        error: e,
      });
    }
  }
}

/**
 * Start scheduler: run every minute to process available investment withdrawals.
 */
export async function startInvestmentWithdrawalScheduler(): Promise<void> {
  const intervalMs = 60 * 1000;
  setInterval(() => {
    processInvestmentWithdrawalAvailability().catch((e) =>
      logger.error("Investment withdrawal job error", { error: e }),
    );
  }, intervalMs);
  logger.info("Investment withdrawal scheduler started", { intervalMs });
}
