/**
 * Daily rebalancing job: runs at 00:00 UTC, calls RebalancingEngine and optionally publishes to REBALANCING queue.
 *
 * AB-026: Uses a distributed MongoDB lock so only one instance executes the
 * daily rebalance under horizontal scaling.
 */
import { connectRabbitMQ, QUEUES } from "../config/rabbitmq";
import { logger } from "../config/logger";
import { rebalancingEngine } from "../services/reserve/RebalancingEngine";
import { acquireJobLock, releaseJobLock } from "../utils/jobLock";

const JOB_NAME = "daily-rebalancing";
// Lock TTL is 23 h — expires before the next midnight run so a crashed instance
// can never block the following day's execution indefinitely.
const LOCK_TTL_S = 23 * 60 * 60;

function getNextMidnightUtc(): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.getTime() - now.getTime();
}

export async function startRebalancingScheduler(): Promise<void> {
  async function runOnce(): Promise<void> {
    const acquired = await acquireJobLock(JOB_NAME, LOCK_TTL_S);
    if (!acquired) {
      logger.info("Rebalancing skipped — another instance holds the lock");
      return;
    }
    try {
      const result = await rebalancingEngine.run();
      if (result.instructions.length > 0) {
        try {
          const ch = await connectRabbitMQ();
          await ch.assertQueue(QUEUES.REBALANCING, { durable: true });
          ch.sendToQueue(
            QUEUES.REBALANCING,
            Buffer.from(
              JSON.stringify({
                eventId: result.eventId,
                instructions: result.instructions,
                totalReserveValueUsd: result.totalReserveValueUsd,
              }),
            ),
            { persistent: true },
          );
          logger.info("Rebalancing event enqueued", {
            eventId: result.eventId,
          });
        } catch (e) {
          logger.warn("Failed to enqueue rebalancing", {
            eventId: result.eventId,
            error: e,
          });
        }
      }
    } catch (e) {
      logger.error("Rebalancing run failed", { error: e });
    } finally {
      await releaseJobLock(JOB_NAME);
    }
  }

  const scheduleNext = (): void => {
    const delayMs = getNextMidnightUtc();
    logger.info("Rebalancing next run scheduled", {
      inMs: delayMs,
      at: new Date(Date.now() + delayMs).toISOString(),
    });
    setTimeout(async () => {
      await runOnce();
      scheduleNext();
    }, delayMs);
  };

  // Run initial check in background to avoid blocking server startup
  void runOnce();
  scheduleNext();
  logger.info("Rebalancing scheduler started (daily at 00:00 UTC)", {
    lockTtlSeconds: LOCK_TTL_S,
  });
}
