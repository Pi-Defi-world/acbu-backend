/**
 * Consumes KYC_PROCESSING queue and runs machine layer for each application.
 */
import type { ConsumeMessage } from "amqplib";
import {
  connectRabbitMQ,
  QUEUES,
  assertQueueWithDLQ,
} from "../config/rabbitmq";
import { logger } from "../config/logger";
import { processApplication } from "../services/kyc/machineLayer";

const QUEUE = QUEUES.KYC_PROCESSING;

export async function startKycProcessingConsumer(): Promise<void> {
  const ch = await connectRabbitMQ();
  await assertQueueWithDLQ(QUEUE);
  ch.prefetch(1);
  ch.consume(
    QUEUE,
    async (msg: ConsumeMessage | null) => {
      if (!msg) return;
      try {
        const body = JSON.parse(msg.content.toString()) as {
          applicationId: string;
        };
        await processApplication(body.applicationId);
        ch.ack(msg);
      } catch (e) {
        logger.error("KYC processing job failed", { error: e });
        ch.nack(msg, false, true);
      }
    },
    { noAck: false },
  );
  logger.info("KYC processing consumer started", { queue: QUEUE });
}
