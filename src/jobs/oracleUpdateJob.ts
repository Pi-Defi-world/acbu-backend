/**
 * Oracle update job: run fetchAndStoreRates every ORACLE_UPDATE_INTERVAL_HOURS (default 6).
 * Jitter is applied to both initial delay and subsequent intervals to prevent
 * thundering herd when multiple backend instances run simultaneously.
 *
 * AB-026: Uses a distributed MongoDB lock so only one instance executes the
 * oracle update per interval under horizontal scaling.
 */
import { config } from "../config/env";
import { logger } from "../config/logger";
import { fetchAndStoreRates } from "../services/oracle";
import { acquireJobLock, releaseJobLock } from "../utils/jobLock";

const INTERVAL_MS = (config.oracle?.updateIntervalHours ?? 6) * 60 * 60 * 1000;
const JITTER_PCT = 0.1;

// AB-026: Lock TTL is set slightly shorter than the interval so the lock is
// guaranteed to expire before the next scheduled run, even if the instance
// that held it crashed without releasing.
const JOB_NAME = "oracle-update";
const LOCK_TTL_S = Math.floor((INTERVAL_MS * 0.9) / 1000); // 90% of interval

let intervalId: ReturnType<typeof setTimeout> | null = null;
let running = false;

function scheduleNext(): void {
  const jitter = (Math.random() * 2 - 1) * INTERVAL_MS * JITTER_PCT;
  const delay = INTERVAL_MS + jitter;
  logger.debug("Oracle update next run scheduled", {
    delayMs: Math.round(delay),
    jitterMs: Math.round(jitter),
  });
  intervalId = setTimeout(async () => {
    if (!running) return;
    const acquired = await acquireJobLock(JOB_NAME, LOCK_TTL_S);
    if (!acquired) {
      logger.info("Oracle update skipped — another instance holds the lock");
      if (running) scheduleNext();
      return;
    }
    try {
      await fetchAndStoreRates();
    } catch (e) {
      logger.error("Oracle scheduled update failed", e);
    } finally {
      await releaseJobLock(JOB_NAME);
    }
    if (running) scheduleNext();
  }, delay);
}

export async function startOracleUpdateScheduler(): Promise<void> {
  if (intervalId) return;
  running = true;

  // Run initial update with jittered delay to avoid duplicate submissions
  const initialJitter = Math.random() * 60000;
  logger.debug("Oracle initial update scheduled with jitter", {
    delayMs: Math.round(initialJitter),
  });
  intervalId = setTimeout(async () => {
    if (!running) return;
    const acquired = await acquireJobLock(JOB_NAME, LOCK_TTL_S);
    if (!acquired) {
      logger.info("Oracle initial update skipped — another instance holds the lock");
      if (running) scheduleNext();
      return;
    }
    try {
      await fetchAndStoreRates();
    } catch (e) {
      logger.error("Oracle initial update failed", e);
    } finally {
      await releaseJobLock(JOB_NAME);
    }
    if (running) scheduleNext();
  }, initialJitter);

  logger.info("Oracle update scheduler started", {
    intervalHours: config.oracle?.updateIntervalHours ?? 6,
    jitterPercent: JITTER_PCT * 100,
    lockTtlSeconds: LOCK_TTL_S,
  });
}

export function stopOracleUpdateScheduler(): void {
  running = false;
  if (intervalId) {
    clearTimeout(intervalId);
    intervalId = null;
    logger.info("Oracle update scheduler stopped");
  }
}
