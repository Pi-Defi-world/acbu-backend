/**
 * Weekly Weight Drift Audit Job
 *
 * Runs every Monday at 00:00 UTC to:
 * 1. Calculate basket weight drift (actual vs policy)
 * 2. Generate comprehensive diff report
 * 3. Create pending audit record for admin approval
 * 4. Emit email notification to admins
 *
 * Acceptance Criteria:
 * - Weekly execution guaranteed (configurable via env)
 * - Diff report includes per-currency analysis with thresholds
 * - Audit stored with "pending" status awaiting manual approval
 * - Audit log entries created for all policy drift events
 *
 * AB-026: Uses a distributed MongoDB lock so only one instance executes the
 * audit per week under horizontal scaling.
 */
import { logger } from "../config/logger";
import { weightDriftAuditService } from "../services/reserve/WeightDriftAuditService";
import { sendEmail } from "../services/notification";
import { config } from "../config/env";
import { acquireJobLock, releaseJobLock } from "../utils/jobLock";

const DEFAULT_INTERVAL_DAYS = 7; // Run weekly
const INTERVAL_MS =
  (parseInt(process.env.WEIGHT_DRIFT_AUDIT_INTERVAL_DAYS || String(DEFAULT_INTERVAL_DAYS), 10) ||
    DEFAULT_INTERVAL_DAYS) *
  24 *
  60 *
  60 *
  1000;

const MAX_TIMEOUT_MS = 2147483647; // Max for 32-bit signed int

const JOB_NAME = "weight-drift-audit";
// Lock TTL is 6 days 22 h — expires well before the next weekly run so a
// crashed instance can never block the following week's execution indefinitely.
const LOCK_TTL_S = (6 * 24 + 22) * 60 * 60;

let stopRequested = false;

/**
 * Get next Monday at 00:00 UTC
 */
function getNextMondayUtc(): number {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  // dayOfWeek: 0=Sunday, 1=Monday, ..., 6=Saturday
  const daysUntilMonday = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7 || 7;

  const nextMonday = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + daysUntilMonday,
      0,
      0,
      0,
      0,
    ),
  );

  return nextMonday.getTime() - now.getTime();
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

/**
 * Normalise the configured admin distribution list into individual recipients.
 *
 * The destination is `config.notification.alertEmail`, which is backed by the
 * comma-separated `NOTIFICATION_ALERT_EMAIL` env var. Splitting on commas
 * without trimming would happily send to " ops@example.com" (note the leading
 * space) and count stray delimiters as recipients, so normalise once here.
 */
export function parseAlertRecipients(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((address) => address.trim())
    .filter((address) => address.length > 0);
}

/**
 * Execute weight drift audit job once
 */
export async function runWeightDriftAuditOnce(): Promise<void> {
  const acquired = await acquireJobLock(JOB_NAME, LOCK_TTL_S);
  if (!acquired) {
    logger.info("Weight drift audit skipped — another instance holds the lock");
    return;
  }

  const startTime = Date.now();

  try {
    logger.info("Starting weight drift audit job");

    // 1. Calculate drift report
    const report = await weightDriftAuditService.calculateDriftReport();

    logger.info("Weight drift report calculated", {
      totalCurrencies: report.totalCurrencies,
      exceedingThreshold: report.currenciesExceedingThreshold,
      maxDrift: report.maxDriftPercent,
    });

    // 2. Create audit in DB (system-initiated, no specific user)
    const audit = await weightDriftAuditService.createAudit(
      report,
      "system", // System-initiated audit
    );

    logger.info("Weight drift audit created", {
      auditId: audit.auditId,
      status: audit.status,
    });

    // 3. Build detailed drift report for email
    const driftSummary = audit.entries
      .map(
        (e) =>
          `  ${e.currency}: Policy=${e.policyWeight}% | Actual=${e.actualWeight}% | Drift=${e.driftPercent > 0 ? "+" : ""}${e.driftPercent.toFixed(2)}%${
            e.exceedsThreshold ? " ⚠️ EXCEEDS THRESHOLD" : ""
          }`,
      )
      .join("\n");

    const emailBody = `
Weight Drift Audit Report - Weekly Summary
==========================================

Period: ${audit.auditPeriodStart.toISOString().split("T")[0]} to ${audit.auditPeriodEnd.toISOString().split("T")[0]}

Summary:
--------
- Total Currencies: ${audit.totalCurrencies}
- Currencies Exceeding Threshold (>2%): ${audit.currenciesExceedingThreshold}
- Maximum Drift: ${audit.maxDriftPercent.toFixed(2)}%
- Audit Status: PENDING APPROVAL

Currency Breakdown:
-------------------
${driftSummary}

Action Required:
----------------
This audit is awaiting manual admin approval. Review the drift report and approve or reject accordingly.

Audit ID: ${audit.auditId}
Created At: ${new Date().toISOString()}
`;

    // 4. Send notification to admins (configurable via env)
    // AB-045 (#995): the destination is config.notification.alertEmail, backed by
    // NOTIFICATION_ALERT_EMAIL in src/config/env.ts. The previously documented
    // ADMIN_NOTIFICATION_EMAIL key never existed on the config object, so the
    // audit report was silently never delivered.
    const adminNotificationEmails = parseAlertRecipients(config.notification.alertEmail);
    if (adminNotificationEmails.length > 0) {
      try {
        await sendEmail(
          adminNotificationEmails.join(","),
          `[ACBU] Weekly Weight Drift Audit - ${audit.currenciesExceedingThreshold > 0 ? "ACTION REQUIRED" : "OK"}`,
          emailBody,
        );

        logger.info("Weight drift audit email sent", {
          auditId: audit.auditId,
          recipientCount: adminNotificationEmails.length,
        });
      } catch (e) {
        logger.warn("Failed to send weight drift audit email", {
          auditId: audit.auditId,
          error: e,
        });
      }
    } else {
      // Surface the skipped notification instead of silently doing nothing, so a
      // missing NOTIFICATION_ALERT_EMAIL is visible to operators in the logs.
      logger.warn("Weight drift audit email skipped: NOTIFICATION_ALERT_EMAIL is not configured", {
        auditId: audit.auditId,
      });
    }

    const duration = Date.now() - startTime;
    logger.info("Weight drift audit job completed", {
      auditId: audit.auditId,
      durationMs: duration,
      exceedingThreshold: audit.currenciesExceedingThreshold,
    });
  } catch (e) {
    const duration = Date.now() - startTime;
    logger.error("Weight drift audit job failed", {
      error: e,
      durationMs: duration,
    });

    // Don't re-throw; allow scheduler to continue
  } finally {
    await releaseJobLock(JOB_NAME);
  }
}

/**
 * Start the weekly weight drift audit scheduler
 */
export async function startWeightDriftAuditScheduler(): Promise<void> {
  stopRequested = false;

  async function runLoop(): Promise<void> {
    while (!stopRequested) {
      try {
        // Run audit immediately on first boot if configured
        if (process.env.WEIGHT_DRIFT_AUDIT_RUN_ON_STARTUP === "true") {
          await runWeightDriftAuditOnce();
          logger.info("Startup weight drift audit completed, scheduling next run");
        }

        // Calculate next run (Monday 00:00 UTC by default)
        const nextRunDelayMs = getNextMondayUtc();
        const nextRunDate = new Date(Date.now() + nextRunDelayMs);

        logger.info("Weight drift audit next run scheduled", {
          nextRunDate: nextRunDate.toISOString(),
          delayDays: (nextRunDelayMs / (24 * 60 * 60 * 1000)).toFixed(1),
        });

        // Wait until next run time
        await longSleep(nextRunDelayMs);

        if (!stopRequested) {
          await runWeightDriftAuditOnce();
        }
      } catch (e) {
        logger.error("Weight drift audit scheduler error", { error: e });
        // Wait 5 minutes before retrying on error
        await longSleep(5 * 60 * 1000);
      }
    }
  }

  // Run scheduler in background
  void runLoop();

  logger.info("Weight drift audit scheduler started", {
    intervalDays: INTERVAL_MS / (24 * 60 * 60 * 1000),
    lockTtlSeconds: LOCK_TTL_S,
  });
}

/**
 * Stop the weight drift audit scheduler gracefully
 */
export function stopWeightDriftAuditScheduler(): void {
  stopRequested = true;
  logger.info("Weight drift audit scheduler stopped");
}
