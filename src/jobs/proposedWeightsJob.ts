/**
 * Proposed basket weights job: ingest metrics (GDP, trade, liquidity) and create
 * BasketConfig rows with status 'proposed'. Admin approves to move to 'active'.
 * Runs on a long interval (e.g. monthly); configurable via env.
 */
import { logger } from "../config/logger";
import { ingestMetricsAndProposeWeights } from "../services/metrics/metricsService";

const DEFAULT_INTERVAL_DAYS = 30;
const INTERVAL_MS =
  (parseInt(process.env.BASKET_METRICS_INTERVAL_DAYS || String(DEFAULT_INTERVAL_DAYS), 10) ||
    DEFAULT_INTERVAL_DAYS) *
  24 *
  60 *
  60 *
  1000;

const MAX_TIMEOUT_MS = 2147483647; // Max for 32-bit signed int

let stopRequested = false;

function getPeriod(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Custom sleep that handles long durations exceeding setTimeout limit
 */
async function longSleep(ms: number): Promise<void> {
  let remaining = ms;
  while (remaining > 0 && !stopRequested) {
    const delay = Math.min(remaining, MAX_TIMEOUT_MS);
    await new Promise((resolve) => setTimeout(resolve, delay));
    remaining -= delay;
  }
}

export async function startProposedWeightsScheduler(): Promise<void> {
  stopRequested = false;

  async function runLoop(): Promise<void> {
    while (!stopRequested) {
      try {
        const period = getPeriod();
        await ingestMetricsAndProposeWeights(period);
      } catch (e) {
        logger.error("Proposed weights job failed", { error: e });
      }

      logger.info("Proposed weights next run scheduled", {
        inDays: INTERVAL_MS / (24 * 60 * 60 * 1000),
      });

      await longSleep(INTERVAL_MS);
    }
  }

  // Run in background
  void runLoop();

  logger.info("Proposed weights scheduler started", {
    intervalDays: INTERVAL_MS / (24 * 60 * 60 * 1000),
  });
}

export function stopProposedWeightsScheduler(): void {
  stopRequested = true;
  logger.info("Proposed weights scheduler stopped");
}
