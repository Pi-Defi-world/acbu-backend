/**
 * Consumes WEBHOOKS queue: deliver outbound webhooks with HMAC-SHA256 signature and retries.
 */
import type { ConsumeMessage } from "amqplib";
import { connectRabbitMQ, QUEUES } from "../config/rabbitmq";
import { logger } from "../config/logger";
import { deliverWebhook } from "../services/webhook";

interface WebhookJobPayload {
  webhookId: string;
}

const MAX_RETRIES = 5;

export async function startWebhookConsumer(): Promise<void> {
  const ch = await connectRabbitMQ();

  // Main queue with DLQ configuration
  await ch.assertQueue(QUEUES.WEBHOOKS, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": QUEUES.WEBHOOKS_DLQ,
    },
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
      const retries =
        typeof headers["x-retries"] === "number" ? headers["x-retries"] : 0;

      try {
        const body = JSON.parse(msg.content.toString()) as WebhookJobPayload;

        const { webhookId } = body;

        if (!webhookId) {
          ch.ack(msg);
          return;
        }

        const ok = await deliverWebhook(webhookId);

        if (ok) {
          ch.ack(msg);
          return;
        }

        //  Failed delivery
        if (retries >= MAX_RETRIES) {
          logger.error("Webhook failed permanently", {
            webhookId,
            retries,
          });

          // send to DLQ
          ch.nack(msg, false, false);
          return;
        }

        // Retry with incremented header
        ch.sendToQueue(QUEUES.WEBHOOKS, msg.content, {
          persistent: true,
          headers: {
            ...headers,
            "x-retries": retries + 1,
          },
        });

        ch.ack(msg);
      } catch (error) {
        logger.error("Webhook consumer error", { error });

        if (retries >= MAX_RETRIES) {
          // send to DLQ
          ch.nack(msg, false, false);
          return;
        }

        // retry on processing error
        ch.sendToQueue(QUEUES.WEBHOOKS, msg.content, {
          persistent: true,
          headers: {
            ...headers,
            "x-retries": retries + 1,
          },
        });

        ch.ack(msg);
      }
    },
    { noAck: false },
  );

  logger.info("Webhook consumer started", {
    queue: QUEUES.WEBHOOKS,
  });
}
