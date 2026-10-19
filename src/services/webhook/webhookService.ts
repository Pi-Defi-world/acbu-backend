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

export interface WebhookRetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
}

const DEFAULT_RETRY_POLICY: WebhookRetryPolicy = {
  maxAttempts: 5,
  initialDelayMs: 1000,
  maxDelayMs: 60_000,
  multiplier: 2,
};

const ENDPOINT_RETRY_POLICIES: Array<{
  matches: (hostname: string) => boolean;
  policy: WebhookRetryPolicy;
}> = [
  {
    matches: (hostname) => hostname.includes("partner") || hostname.includes("api"),
    policy: {
      maxAttempts: 8,
      initialDelayMs: 2500,
      maxDelayMs: 60_000,
      multiplier: 2,
    },
  },
];

export function getRetryPolicyForUrl(url: string): WebhookRetryPolicy {
  if (!url) return DEFAULT_RETRY_POLICY;

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const policy = ENDPOINT_RETRY_POLICIES.find(({ matches }) => matches(hostname));
    return policy?.policy ?? DEFAULT_RETRY_POLICY;
  } catch {
    return DEFAULT_RETRY_POLICY;
  }
}

export type WebhookEventType =
  "transaction.completed" | "transaction.failed" | "mint.completed" | "burn.completed";

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

function buildPayload(eventType: WebhookEventType, data: Record<string, unknown>): WebhookPayload {
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
  const signature = config.webhook.secret ? signPayload(payloadStr, config.webhook.secret) : null;

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
  ch.sendToQueue(QUEUES.WEBHOOKS, Buffer.from(JSON.stringify({ webhookId: webhook.id })), {
    persistent: true,
  });
  logger.info("Webhook enqueued", { webhookId: webhook.id, eventType });
  return webhook.id;
}

export async function deliverWebhook(
  webhookId: string,
): Promise<{ success: boolean; terminal: boolean }> {
  const webhook = await prisma.webhook.findUnique({
    where: { id: webhookId },
  });
  if (!webhook) {
    logger.warn("Webhook not found", { webhookId });
    return { success: false, terminal: true };
  }
  if (webhook.status === "completed") {
    logger.debug("Webhook already completed", { webhookId });
    return { success: true, terminal: false };
  }
  if (webhook.status === "failed") {
    logger.debug("Webhook already marked failed; skipping redelivery", {
      webhookId,
    });
    return { success: false, terminal: true };
  }

  const url = config.webhook.url;
  if (!url) {
    await prisma.webhook.update({
      where: { id: webhookId },
      data: { status: "failed" },
    });
    return { success: false, terminal: true };
  }

  const retryPolicy = getRetryPolicyForUrl(url);
  let attempts = webhook.attempts;
  const payloadStr = JSON.stringify(webhook.payload);
  const signature =
    webhook.signature ??
    (config.webhook.secret ? signPayload(payloadStr, config.webhook.secret) : null);

  while (attempts < retryPolicy.maxAttempts) {
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
          "Idempotency-Key": webhookId,
          ...(signature && { [WEBHOOK_HEADER_SIGNATURE]: signature }),
        },
        timeout: 10000,
      });
      attempts += 1;
      await prisma.webhook.update({
        where: { id: webhookId },
        data: {
          status: "completed",
          attempts,
          lastAttemptAt: new Date(),
        },
      });
      logger.info("Webhook delivered", {
        webhookId,
        url: "***",
      });
      return { success: true, terminal: false };
    } catch (e) {
      attempts += 1;
      const terminalFailure = attempts >= retryPolicy.maxAttempts;
      await prisma.webhook.update({
        where: { id: webhookId },
        data: {
          status: terminalFailure ? "failed" : "pending",
          attempts,
          lastAttemptAt: new Date(),
        },
      });

      if (terminalFailure) {
        logger.warn("Webhook delivery failed permanently", {
          webhookId,
          attempts,
          retryPolicy,
          error: e,
        });
        return { success: false, terminal: true };
      }

      const delayMs = Math.min(
        retryPolicy.initialDelayMs * retryPolicy.multiplier ** (attempts - 1),
        retryPolicy.maxDelayMs,
      );
      logger.warn("Webhook delivery failed; retrying with endpoint-specific backoff", {
        webhookId,
        attempts,
        delayMs,
        retryPolicy,
        error: e,
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { success: false, terminal: true };
}
