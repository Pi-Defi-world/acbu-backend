/**
 * Outbound WebhookService: build payload by event type, sign with HMAC-SHA256, deliver with retries.
 */
import crypto from "crypto";
import axios from "axios";
import { prisma } from "../../config/database";
import { config } from "../../config/env";
import { logger } from "../../config/logger";
import { connectRabbitMQ, QUEUES } from "../../config/rabbitmq";

const WEBHOOK_HEADER_SIGNATURE = "x-acbu-signature";
const MAX_ATTEMPTS = 5;

export type WebhookEventType =
  | "transaction.completed"
  | "transaction.failed"
  | "mint.completed"
  | "burn.completed";

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

function buildPayload(
  eventType: WebhookEventType,
  data: Record<string, unknown>,
): WebhookPayload {
  return {
    event: eventType,
    timestamp: new Date().toISOString(),
    data,
  };
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export async function enqueueWebhook(
  eventType: WebhookEventType,
  data: Record<string, unknown>,
  transactionId?: string,
): Promise<string | null> {
  const url = config.webhook.url;
  if (!url) {
    logger.debug("Webhook URL not configured; skipping enqueue");
    return null;
  }

  const payload = buildPayload(eventType, data);
  const payloadStr = JSON.stringify(payload);
  const signature = config.webhook.secret
    ? signPayload(payloadStr, config.webhook.secret)
    : null;

  const webhook = await prisma.webhook.create({
    data: {
      eventType,
      payload: payload as object,
      signature,
      status: "pending",
      transactionId,
    },
  });

  const ch = await connectRabbitMQ();
  await ch.assertQueue(QUEUES.WEBHOOKS, { durable: true });
  ch.sendToQueue(
    QUEUES.WEBHOOKS,
    Buffer.from(JSON.stringify({ webhookId: webhook.id })),
    { persistent: true },
  );
  logger.info("Webhook enqueued", { webhookId: webhook.id, eventType });
  return webhook.id;
}

export async function deliverWebhook(webhookId: string): Promise<boolean> {
  const webhook = await prisma.webhook.findUnique({
    where: { id: webhookId },
  });
  if (!webhook) {
    logger.warn("Webhook not found", { webhookId });
    return false;
  }
  if (webhook.status === "completed") {
    logger.debug("Webhook already completed", { webhookId });
    return true;
  }
  if (webhook.status === "failed") {
    logger.debug("Webhook already marked failed; skipping redelivery", {
      webhookId,
    });
    return true;
  }

  const url = config.webhook.url;
  if (!url) {
    await prisma.webhook.update({
      where: { id: webhookId },
      data: { status: "failed" },
    });
    return false;
  }

  const payloadStr = JSON.stringify(webhook.payload);
  const signature =
    webhook.signature ??
    (config.webhook.secret
      ? signPayload(payloadStr, config.webhook.secret)
      : null);

  try {
    await axios.post(url, webhook.payload, {
      headers: {
        "Content-Type": "application/json",
        ...(signature && { [WEBHOOK_HEADER_SIGNATURE]: signature }),
      },
      timeout: 10000,
    });
    await prisma.webhook.update({
      where: { id: webhookId },
      data: {
        status: "completed",
        attempts: webhook.attempts + 1,
        lastAttemptAt: new Date(),
      },
    });
    logger.info("Webhook delivered", {
      webhookId,
      url: url ? "***" : undefined,
    });
    return true;
  } catch (e) {
    const attempts = webhook.attempts + 1;
    const terminalFailure = attempts >= MAX_ATTEMPTS;
    await prisma.webhook.update({
      where: { id: webhookId },
      data: {
        status: terminalFailure ? "failed" : "pending",
        attempts,
        lastAttemptAt: new Date(),
      },
    });
    logger.warn("Webhook delivery failed", {
      webhookId,
      attempts,
      terminalFailure,
      error: e,
    });
    // Return true for terminal failures so consumer can ack and stop requeueing.
    return terminalFailure;
  }
}
