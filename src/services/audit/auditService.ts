import { logger } from "../../config/logger";
import { config } from "../../config/env";
import fs from "fs";
import path from "path";
import { sendEmail } from "../notification";
import { getRabbitMQChannel, QUEUES } from "../../config/rabbitmq";
import { getMongoDB } from "../../config/mongodb";

export interface AuditEntry {
  eventType: string;
  entityType?: string;
  entityId?: string;
  action: string;
  oldValue?: object;
  newValue?: object;
  performedBy?: string;
  actorType?: string;
  keyType?: "USER_KEY" | "ADMIN_KEY" | "BREAK_GLASS_KEY";
  organizationId?: string;
  reason?: string;
}

function validateAdminAttribution(entry: AuditEntry): void {
  if (entry.keyType !== "ADMIN_KEY" && entry.keyType !== "BREAK_GLASS_KEY") {
    return;
  }

  if (!entry.performedBy || !entry.actorType || !entry.organizationId || !entry.reason) {
    throw new Error(
      "Admin audit entries require performedBy, actorType, organizationId, and reason",
    );
  }
}

interface AuditPayload extends AuditEntry {
  timestamp: string;
}

interface OutboxDocument extends AuditPayload {
  savedAt: Date;
  failureReason: string;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempt to publish to RabbitMQ with exponential backoff retries.
 * Returns true on success, throws on final failure.
 */
async function publishWithRetry(payload: AuditPayload): Promise<void> {
  let lastError: Error = new Error("Unknown error");

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const channel = getRabbitMQChannel();
      const sent = channel.sendToQueue(
        QUEUES.AUDIT_LOGS,
        Buffer.from(JSON.stringify(payload)),
        { persistent: true },
      );

      if (!sent) {
        throw new Error("RabbitMQ sendToQueue returned false");
      }

      logger.debug("Audit entry published to queue", {
        eventType: payload.eventType,
        action: payload.action,
        attempt,
      });
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        logger.warn(`Audit publish attempt ${attempt} failed, retrying`, {
          eventType: payload.eventType,
          error: lastError.message,
        });
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastError;
}

/**
 * Save failed audit event to MongoDB outbox so it is never lost.
 * Falls back to local file if MongoDB is also unavailable.
 */
async function saveToOutbox(
  payload: AuditPayload,
  failureReason: string,
): Promise<void> {
  try {
    const db = getMongoDB();
    const doc: OutboxDocument = {
      ...payload,
      savedAt: new Date(),
      failureReason,
    };
    await db.collection("audit_outbox").insertOne(doc);
    logger.warn("Audit event saved to MongoDB outbox", {
      eventType: payload.eventType,
      failureReason,
    });
  } catch (mongoErr) {
    const mongoMessage =
      mongoErr instanceof Error ? mongoErr.message : String(mongoErr);
    logger.error("CRITICAL: Audit outbox write failed — falling back to file", {
      eventType: payload.eventType,
      mongoError: mongoMessage,
    });
    saveToFallbackFile(payload, failureReason);
    alertAdmin(payload, failureReason);
  }
}

function saveToFallbackFile(
  payload: AuditPayload,
  failureReason: string,
): void {
  try {
    const logDir = path.dirname(config.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const fallbackPath = path.join(logDir, "lost-audits.log");
    const line = JSON.stringify({ ...payload, failureReason }) + "\n";
    fs.appendFileSync(fallbackPath, line);
    logger.info(`Audit entry saved to fallback file: ${fallbackPath}`);
  } catch (fileErr) {
    logger.error("FATAL: Failed to write to audit fallback file", {
      error: fileErr instanceof Error ? fileErr.message : String(fileErr),
    });
  }
}

function alertAdmin(payload: AuditPayload, failureReason: string): void {
  if (!config.notification.alertEmail) return;

  const subject = `CRITICAL: Audit Log System Failure - ${payload.eventType}`;
  const body =
    `Audit logging failed after ${MAX_RETRIES} retries and MongoDB outbox also failed.\n\n` +
    `Event Type: ${payload.eventType}\n` +
    `Action: ${payload.action}\n` +
    `Failure: ${failureReason}\n\n` +
    `Entry: ${JSON.stringify(payload, null, 2)}`;

  sendEmail(config.notification.alertEmail, subject, body).catch((e) => {
    logger.error("Failed to send audit failure alert email", {
      error: e instanceof Error ? e.message : String(e),
    });
  });
}

/**
 * logAudit: Publishes audit entry to RabbitMQ with retry.
 * On sustained failure saves to MongoDB outbox so events are never lost.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  const payload: AuditPayload = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  try {
    await publishWithRetry(payload);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error(
      `Audit publish failed after ${MAX_RETRIES} retries — saving to outbox`,
      { eventType: entry.eventType, error: reason },
    );
    await saveToOutbox(payload, reason);
  }
}
