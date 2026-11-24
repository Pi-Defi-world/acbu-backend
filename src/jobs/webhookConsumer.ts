/**
 * Consumes WEBHOOKS queue: deliver outbound webhooks with HMAC-SHA256 signature and retries.
 */
import type { ConsumeMessage } from "amqplib";
import { connectRabbitMQ, QUEUES } from "../config/rabbitmq";
import { getQueueMaxRetries } from "./queueConfig";
import { logger } from "../config/logger";
import { deliverWebhook } from "../services/webhook";
import {
  parseIncomingMessage,
  deadLetterMessage,
  MessageValidationError,
} from "../utils/rabbitmq-validation";

const MAX_RETRIES = getQueueMaxRetries(QUEUES.WEBHOOKS);

export async function startWebhookConsumer(): Promise<void> {
  const ch = await connectRabbitMQ();

  // Main queue
  await ch.assertQueue(QUEUES.WEBHOOKS, {
    durable: true,
  });

  // Dead-letter queue
  await ch.assertQueue(QUEUES.WEBHOOKS_DLQ, {
    durable: true,
  });

  ch.prefetch(1);

  ch.consume(
    QUEUES.WEBHOOKS,
    async (msg: ConsumeMessage | null) => {
      if (!msg) return;

      const headers = msg.properties.headers ?? {};
      const retries = typeof headers["x-retries"] === "number" ? headers["x-retries"] : 0;

      try {
        // Validate webhook message; the payload type is inferred from the queue
        // constant (WebhookJob) rather than asserted by the caller.
        const validatedPayload = parseIncomingMessage(QUEUES.WEBHOOKS, msg.content);
        const { webhookId } = validatedPayload;

        if (!webhookId) {
          ch.ack(msg);
          return;
        }

        const result = await deliverWebhook(webhookId);

        if (result.success) {
          ch.ack(msg);
          return;
        }

        // Failed delivery
        if (result.terminal || retries >= MAX_RETRIES) {
          logger.error("Webhook failed permanently", { webhookId, retries });
          ch.sendToQueue(QUEUES.WEBHOOKS_DLQ, msg.content, { persistent: true });
          ch.ack(msg);
          return;
        }

        // Exponential backoff: ack immediately, re-enqueue after delay so the
        // channel is not blocked and other messages can be processed.
        ch.ack(msg);
        const backoffMs = Math.min(Math.pow(2, retries) * 1000, 60_000);
        setTimeout(() => {
          ch.sendToQueue(QUEUES.WEBHOOKS, msg.content, {
            persistent: true,
            headers: { ...headers, "x-retries": retries + 1 },
          });
        }, backoffMs);
        logger.info("Webhook retry scheduled", { webhookId, retries, backoffMs });
      } catch (error) {
        if (error instanceof MessageValidationError) {
          logger.error("Webhook validation failed, sending to DLQ", {
            errors: error.validationErrors,
          });
          await deadLetterMessage(
            QUEUES.WEBHOOKS,
            msg.content,
            `Validation failed: ${error.message}`,
          );
          ch.ack(msg);
          return;
        }

        logger.error("Webhook consumer error", { error });

        ch.ack(msg);

        if (retries >= MAX_RETRIES) {
          ch.sendToQueue(QUEUES.WEBHOOKS_DLQ, msg.content, { persistent: true });
          return;
        }

        const backoffMs = Math.min(Math.pow(2, retries) * 1000, 60_000);
        setTimeout(() => {
          ch.sendToQueue(QUEUES.WEBHOOKS, msg.content, {
            persistent: true,
            headers: { ...headers, "x-retries": retries + 1 },
          });
        }, backoffMs);
      }
    },
    { noAck: false },
  );

  logger.info("Webhook consumer started with validation", {
    queue: QUEUES.WEBHOOKS,
  });
}
