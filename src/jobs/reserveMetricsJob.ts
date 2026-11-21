/**
 * W10-I-013: Scheduled job to update reserve ratio metrics.
 *
 * Runs periodically to fetch the latest reserve snapshots and update
 * Prometheus gauges for monitoring and alerting.
 */

import { logger } from "../config/logger";
import { updateReserveMetrics } from "../services/monitoring";

let jobInterval: NodeJS.Timeout | null = null;

/**
 * Start the reserve metrics update job.
 * Runs every 5 minutes by default.
 */
export function startReserveMetricsJob(intervalMs: number = 5 * 60 * 1000): void {
  if (jobInterval) {
    logger.warn("Reserve metrics job already running");
    return;
  }

  // Run immediately on start
  updateReserveMetrics().catch((error) => {
    logger.error("Initial reserve metrics update failed", { error });
  });

  // Schedule periodic updates
  jobInterval = setInterval(() => {
    updateReserveMetrics().catch((error) => {
      logger.error("Scheduled reserve metrics update failed", { error });
    });
  }, intervalMs);

  logger.info("Reserve metrics job started", { intervalMs });
}

/**
 * Stop the reserve metrics update job.
 */
export function stopReserveMetricsJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
    logger.info("Reserve metrics job stopped");
  }
}
