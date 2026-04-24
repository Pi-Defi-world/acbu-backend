import { prisma } from "../config/database";
import { logger } from "../config/logger";
import { QUEUES, assertQueueWithDLQ } from "../config/rabbitmq";
import { getRabbitMQChannel } from "../config/rabbitmq";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

export async function startAuditConsumer() {
  const channel = getRabbitMQChannel();

  await assertQueueWithDLQ(QUEUES.AUDIT_LOGS, { durable: true });

  channel.consume(QUEUES.AUDIT_LOGS, async (msg) => {
    if (!msg) return;

    const content = msg.content.toString();
    const entry = JSON.parse(content);

    let attempt = 0;
    let success = false;

    while (attempt <= MAX_RETRIES && !success) {
      try {
        await prisma.auditTrail.create({
          data: {
            eventType: entry.eventType,
            entityType: entry.entityType ?? null,
            entityId: entry.entityId ?? null,
            action: entry.action,
            oldValue: entry.oldValue ?? (undefined as any),
            newValue: entry.newValue ?? (undefined as any),
            performedBy: entry.performedBy ?? null,
            actorType: entry.actorType ?? null,
            keyType: entry.keyType ?? null,
            organizationId: entry.organizationId ?? null,
            reason: entry.reason ?? null,
            timestamp: entry.timestamp ? new Date(entry.timestamp) : undefined,
          },
        });
        success = true;
        channel.ack(msg);
      } catch (error: any) {
        attempt++;
        if (attempt <= MAX_RETRIES) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
          logger.warn(
            `Audit consumer retry ${attempt}/${MAX_RETRIES} in ${backoff}ms`,
            {
              error: error.message || error,
              eventType: entry.eventType,
            },
          );
          await new Promise((resolve) => setTimeout(resolve, backoff));
        } else {
          logger.error(
            "Audit consumer failed after max retries, moving to DLQ",
            {
              error: error.message || error,
              entry,
            },
          );
          // Reject to DLQ
          channel.nack(msg, false, false);
        }
      }
    }
  });

  logger.info("Audit consumer started");
}
