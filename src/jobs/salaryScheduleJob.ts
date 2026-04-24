import { prisma } from "../config/database";
import { triggerSchedule } from "../services/salary/salaryService";
import { logger } from "../config/logger";

/**
 * Checks for and processes due salary schedules.
 */
export async function processSalarySchedules(): Promise<void> {
  const now = new Date();

  const dueSchedules = await prisma.salarySchedule.findMany({
    where: {
      status: "active",
      nextRunAt: { lte: now },
    },
    take: 50,
  });

  if (dueSchedules.length === 0) return;

  logger.info(`Found ${dueSchedules.length} due salary schedules`);

  for (const schedule of dueSchedules) {
    try {
      await triggerSchedule(schedule.id);
      logger.info("Triggered salary schedule", { scheduleId: schedule.id });
    } catch (err) {
      logger.error("Failed to trigger salary schedule", {
        scheduleId: schedule.id,
        error: err,
      });
    }
  }
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
