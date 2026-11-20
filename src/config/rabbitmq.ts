import amqp, { ChannelModel, ConfirmChannel } from "amqplib";
import { config } from "./env";
import { logger } from "./logger";
import {
  recordQueueDepth,
  recordQueuePublish,
  recordQueueConsume,
  recordQueueError,
} from "../services/monitoring";

let connection: ChannelModel | null = null;
let channel: ConfirmChannel | null = null;

export async function connectRabbitMQ(): Promise<ConfirmChannel> {
  if (channel) {
    return channel;
  }

  try {
    // Heartbeat of 30 s ensures the client detects silent TCP drops within one
    // heartbeat interval rather than waiting for the next publish attempt.
    // Network appliances that drop idle connections after 60 s are covered
    // because the client sends a frame every 30 s.
    connection = await amqp.connect(config.rabbitmqUrl, { heartbeat: 30 });
    const ch = await connection.createConfirmChannel();
    channel = ch;
    logger.info("RabbitMQ connected successfully");

    await ch.assertExchange(EXCHANGES.DLX, "direct", { durable: true });
    logger.info("Dead letter exchange asserted");

    // Handle connection errors
    connection.on("error", (err: Error) => {
      logger.error("RabbitMQ connection error", err);
    });

    connection.on("close", () => {
      logger.warn("RabbitMQ connection closed");
      connection = null;
      channel = null;
    });

    return ch;
  } catch (error) {
    logger.error("Failed to connect to RabbitMQ", error);
    throw error;
  }
}

export interface QueueOptions extends amqp.Options.AssertQueue {
  deadLetterQueue?: string;
}

export async function assertQueueWithDLQ(
  queueName: string,
  options: QueueOptions = {},
): Promise<amqp.Replies.AssertQueue> {
  const ch = getRabbitMQChannel();
  const dlqName = `${queueName}_dlq`;

  await ch.assertQueue(dlqName, { durable: true });

  await ch.bindQueue(dlqName, EXCHANGES.DLX, queueName);

  const queueOptions: amqp.Options.AssertQueue = {
    ...options,
    durable: true,
    arguments: {
      ...options.arguments,
      deadLetterExchange: EXCHANGES.DLX,
      deadLetterRoutingKey: queueName,
    },
  };

  const result = await ch.assertQueue(queueName, queueOptions);

  // W10-I-013: Record initial queue depth
  recordQueueDepth(queueName, result.messageCount);
  recordQueueDepth(dlqName, 0);

  return result;
}

export async function disconnectRabbitMQ(): Promise<void> {
  if (channel) {
    try {
      await channel.waitForConfirms();
      logger.info("All in-flight producer confirms resolved");
    } catch (err) {
      logger.error("Error waiting for RabbitMQ producer confirms", err);
    }
    await channel.close();
    channel = null;
  }
  if (connection) {
    await connection.close();
    connection = null;
    logger.info("RabbitMQ disconnected");
  }
}

export function getRabbitMQChannel(): ConfirmChannel {
  if (!channel) {
    logger.warn("RabbitMQ not connected, throwing error on channel request");
    throw new Error("RabbitMQ not connected. Call connectRabbitMQ() first.");
  }
  return channel;
}

/**
 * W10-I-013: Instrumented publish wrapper to track queue metrics.
 */
export async function publishWithMetrics(
  exchange: string,
  routingKey: string,
  content: Buffer,
  options?: amqp.Options.Publish,
): Promise<boolean> {
  const ch = getRabbitMQChannel();
  recordQueuePublish(routingKey);

  return new Promise((resolve, reject) => {
    ch.publish(exchange, routingKey, content, options, (err) => {
      if (err) {
        recordQueueError(routingKey, "publish_failed");
        reject(err);
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * W10-I-013: Instrumented consume wrapper to track queue metrics.
 */
export async function consumeWithMetrics(
  queueName: string,
  onMessage: (msg: amqp.ConsumeMessage) => void,
  options?: amqp.Options.Consume,
): Promise<amqp.Replies.Consume> {
  const ch = getRabbitMQChannel();

  const wrappedHandler = (msg: amqp.ConsumeMessage | null) => {
    if (msg) {
      recordQueueConsume(queueName);
      // Update queue depth after consumption
      ch.checkQueue(queueName).then((info) => {
        recordQueueDepth(queueName, info.messageCount);
      }).catch(() => {});
      onMessage(msg);
    }
  };

  return ch.consume(queueName, wrappedHandler, options);
}

// Queue names
export const QUEUES = {
  USDC_CONVERSION: "usdc_conversion",
  USDC_CONVERSION_DLQ: "usdc_conversion_dlq",
  WITHDRAWAL_PROCESSING: "withdrawal_processing",
  WITHDRAWAL_PROCESSING_DLQ: "withdrawal_processing_dlq",
  REBALANCING: "rebalancing",
  REBALANCING_DLQ: "rebalancing_dlq",
  NOTIFICATIONS: "notifications",
  NOTIFICATIONS_DLQ: "notifications_dlq",
  OTP_SEND: "otp_send", // OTP delivery (email/SMS) via worker
  OTP_SEND_DLQ: "otp_send_dlq",
  WEBHOOKS: "webhooks",
  WEBHOOKS_DLQ: "webhooks_dlq", // failed webhook deliveries for retry
  ACBU_SAVINGS_VAULT_EVENTS: "acbu_savings_vault_events",
  ACBU_SAVINGS_VAULT_EVENTS_DLQ: "acbu_savings_vault_events_dlq",
  ACBU_LENDING_POOL_EVENTS: "acbu_lending_pool_events",
  ACBU_LENDING_POOL_EVENTS_DLQ: "acbu_lending_pool_events_dlq",
  ACBU_ESCROW_EVENTS: "acbu_escrow_events",
  ACBU_ESCROW_EVENTS_DLQ: "acbu_escrow_events_dlq",
  STELLAR_EVENT_FAILURES: "stellar_event_failures",
  STELLAR_EVENT_FAILURES_DLQ: "stellar_event_failures_dlq",
  XLM_TO_ACBU: "xlm_to_acbu", // XLM deposit: sell XLM and mint ACBU to user
  XLM_TO_ACBU_DLQ: "xlm_to_acbu_dlq",
  USDC_CONVERT_AND_MINT: "usdc_convert_and_mint", // USDC deposit: convert USDC→XLM (backend), then mint
  AUDIT_LOGS: "audit_logs",
  USDC_CONVERT_AND_MINT_DLQ: "usdc_convert_and_mint_dlq",
  AUDIT_LOGS_DLQ: "audit_logs_dlq",
} as const;

// Exchange names
export const EXCHANGES = {
  RESERVE_EVENTS: "reserve_events",
  TRANSACTION_EVENTS: "transaction_events",
  DLX: "dlx", // Dead letter exchange
} as const;
