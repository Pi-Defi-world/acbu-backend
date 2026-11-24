import { prisma } from "../config/database";
import { triggerSchedule } from "../services/salary/salaryService";
import { logger } from "../config/logger";
import { acquireJobLock, releaseJobLock } from "../utils/jobLock";
import { retryWithBackoff } from "../utils/retry";

const JOB_NAME = "salary-schedule";
const LOCK_TTL_S = 55; // hold for up to 55s (< 60s interval)
const PAGE_SIZE = 50;
const MAX_PAGES = 100; // safety bound per tick
/**
 * Checks for and processes due salary schedules.
 * Guarded by a distributed MongoDB lock so only one instance runs per tick (#418).
 */
export async function processSalarySchedules(): Promise<void> {
  const acquired = await acquireJobLock(JOB_NAME, LOCK_TTL_S);
  if (!acquired) {
    logger.debug("Salary schedule job skipped — another instance holds the lock");
    return;
  }
  try {
    await _processSalarySchedules();
  } finally {
    await releaseJobLock(JOB_NAME);
  }
}

async function _processSalarySchedules(): Promise<void> {
  const now = new Date();
  let cursorNextRunAt: Date | undefined;
  let cursorId: string | undefined;
  let processed = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const where: Record<string, unknown> = {
      status: "active",
      nextRunAt: { lte: now },
    };
    if (cursorNextRunAt !== undefined && cursorId !== undefined) {
      where.OR = [
        { nextRunAt: { gt: cursorNextRunAt } },
        { nextRunAt: cursorNextRunAt, id: { gt: cursorId } },
      ];
    }

    const dueSchedules = await prisma.salarySchedule.findMany({
      where,
      ordesBy: [{ nextRunAt: "asc" }, { id: "asc" }],
      take: PAGE_SIZE,
    });

    if (dueSchedules.length === 0) break;

    logger.info(`Found ${dueSchedules.length} due salary schedules (page ${page + 1})`);

    for (const schedule of dueSchedules) {
      cursorNextRunAt = schedule.nextRunAt ?? cursorNextRunAt;
      cursorId = schedule.id;
      processed++;

      // Advance nextRunAt before triggering so a failure cannot cause infinite re-fire.
      try {
        const nextRunAt = computeNextRun(schedule.cron, new Date());
        await prisma.salarySchedule.update({
          where: { id: schedule.id },
          data: { nextRunAt },
        });
      } catch (err) {
        logger.error("Failed to advance salary schedule nextRunAt", {
          scheduleId: schedule.id,
          error: err,
        });
        // Skip triggering if we can't advance the schedule.
        continue;
      }

      try {
        await retryWithBackoff(() => triggerSchedule(schedule.id), {
          attempts: 3,
          initialDelayMs: 250,
          onRetry: (error, attempt, delayMs) =>
            logger.warn("Retrying salary schedule trigger", {
              scheduleId: schedule.id,
              attempt,
              delayMs,
              error,
            }),
        });
        logger.info("Triggered salary schedule", { scheduleId: schedule.id });
      } catch (err) {
        logger.error("Failed to trigger salary schedule after retries", {
          scheduleId: schedule.id,
          error: err,
        });
      }
    }

    if (dueSchedules.length < PAGE_SIZE) break;
  }

  if (processed === 0) return;
  logger.info(`Processed ${processed} due salary schedules`);
}

/**
 * Start the salary schedule scheduler.
 */
export async function startSalaryScheduleScheduler(): Promise<void> {
  const intervalMs = 60 * 1000; // Run every minute

  setInterval(() => {
    processSalarySchedules().catch((err) => {
      logger.error("Salary schedule job error", { error: err });
    });
  }, intervalMs);

  logger.info("Salary schedule scheduler started", { intervalMs });
}
