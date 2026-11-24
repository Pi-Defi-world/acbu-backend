import { logger } from "../config/logger";
import { accrueFromStrategies } from "../services/investment";
import { acquireJobLock, releaseJobLock } from "../utils/jobLock";

const JOB_NAME = "yield-accrual";
const LOCK_TTL_S = 23 * 60 * 60; // hold lock for up to 23 h (< 24 h interval)

/**
 * Start yield accrual scheduler.
 * - Runs once at startup to ensure seeded data has accruals recorded.
 * - Schedules a daily run to pro-rate accruals (can be adjusted later).
 * - Uses a distributed MongoDB lock so only one instance runs per interval (#418).
 */
export async function startYieldAccrualScheduler(): Promise<void> {
  async function runOnce(): Promise<void> {
    const acquired = await acquireJobLock(JOB_NAME, LOCK_TTL_S);
    if (!acquired) {
      logger.info("Yield accrual skipped — another instance holds the lock");
      return;
    }
    try {
      await accrueFromStrategies(1, new Date());
      logger.info("Yield accrual completed");
    } catch (err) {
      logger.error("Yield accrual failed", err);
    } finally {
      await releaseJobLock(JOB_NAME);
    }
  }

  try {
    logger.info("Running initial yield accrual pass");
    await runOnce();
  } catch (err) {
    logger.error("Initial yield accrual failed", err);
  }

  setInterval(
    () => {
      runOnce().catch((e) => logger.error("Scheduled yield accrual failed", e));
    },
    24 * 60 * 60 * 1000,
  );

  logger.info("Yield accrual scheduler started (daily)");
}
