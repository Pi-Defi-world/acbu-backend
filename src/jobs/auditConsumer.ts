import type { ConsumeMessage } from "amqplib";
import { prisma } from "../config/database";
import { logger } from "../config/logger";
import { QUEUES, assertQueueWithDLQ, getRabbitMQChannel } from "../config/rabbitmq";
import {
  parseIncomingMessage,
  deadLetterMessage,
  MessageValidationError,
} from "../utils/rabbitmq-validation";
import { getQueueMaxRetries } from "./queueConfig";

const MAX_RETRIES = getQueueMaxRetries(QUEUES.AUDIT_LOGS);
const INITIAL_BACKOFF_MS = 1000;

export async function startAuditConsumer() {
  const channel = getRabbitMQChannel();

  await assertQueueWithDLQ(QUEUES.AUDIT_LOGS, { durable: true });

  channel.prefetch(1);
  channel.consume(
    QUEUES.AUDIT_LOGS,
    async (msg: ConsumeMessage | null) => {
      if (!msg) return;

      const content = msg.content;

      try {
        // Validate message using schema; the payload type is inferred from the
        // queue constant (AuditLog) rather than asserted by the caller.
        const validatedEntry = parseIncomingMessage(QUEUES.AUDIT_LOGS, content);

        let attempt = 0;
        let success = false;

        while (attempt <= MAX_RETRIES && !success) {
          try {
            await prisma.auditTrail.create({
              data: {
                eventType: validatedEntry.eventType,
                entityType: validatedEntry.entityType ?? null,
                entityId: validatedEntry.entityId ?? null,
                action: validatedEntry.action,
                oldValue: validatedEntry.oldValue ?? (undefined as any),
                newValue: validatedEntry.newValue ?? (undefined as any),
                performedBy: validatedEntry.performedBy ?? null,
                actorType: validatedEntry.actorType ?? null,
                keyType: validatedEntry.keyType ?? null,
                organizationId: validatedEntry.organizationId ?? null,
                reason: validatedEntry.reason ?? null,
                timestamp: validatedEntry.timestamp
                  ? new Date(validatedEntry.timestamp)
                  : undefined,
              },
            });
            success = true;
            channel.ack(msg);
          } catch (error: any) {
            attempt++;
            if (attempt <= MAX_RETRIES) {
              const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
              logger.warn(`Audit consumer retry ${attempt}/${MAX_RETRIES} in ${backoff}ms`, {
                error: error.message || error,
                eventType: validatedEntry.eventType,
              });
              await new Promise((resolve) => setTimeout(resolve, backoff));
            } else {
              logger.error("Audit consumer failed after max retries, moving to DLQ", {
                error: error.message || error,
                entry: validatedEntry,
              });
              // Reject to DLQ
              channel.nack(msg, false, false);
            }
          }
        }
      } catch (error) {
        if (error instanceof MessageValidationError) {
          logger.error("Message validation failed, sending to DLQ", {
            queue: QUEUES.AUDIT_LOGS,
            errors: error.validationErrors,
          });
          await deadLetterMessage(
            QUEUES.AUDIT_LOGS,
            content,
            `Validation failed: ${error.message}`,
          );
          channel.ack(msg);
        } else {
          logger.error("Unexpected error in audit consumer", {
            error: error instanceof Error ? error.message : String(error),
          });
          channel.nack(msg, false, false);
        }
      }
    },
    { noAck: false },
  );

  logger.info("Audit consumer started with validation");
}
