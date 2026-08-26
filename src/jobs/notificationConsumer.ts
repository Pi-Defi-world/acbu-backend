/**
 * Consumes OTP_SEND and NOTIFICATIONS queues; sends email/SMS via NotificationService.
 */
import type { ConsumeMessage } from "amqplib";
import { connectRabbitMQ, QUEUES, assertQueueWithDLQ } from "../config/rabbitmq";
import { getQueueMaxRetries } from "./queueConfig";
import { logger } from "../config/logger";
import { prisma } from "../config/database";
import {
  sendEmail,
  sendEmailBatch,
  sendSms,
  renderOtpTemplate,
  renderWithdrawalStatusTemplate,
  renderReserveAlertTemplate,
  renderInvestmentWithdrawalReadyTemplate,
} from "../services/notification";
import {
  parseIncomingMessage,
  deadLetterMessage,
  MessageValidationError,
} from "../utils/rabbitmq-validation";
import type { OtpSend, Notification } from "../types/rabbitmq-schemas";

async function processOtpSend(payload: OtpSend): Promise<void> {
  const { channel, to, code } = payload;
  const body = renderOtpTemplate(code);
  if (channel === "email") {
    await sendEmail(to, "Your ACBU verification code", body);
  } else if (channel === "sms") {
    await sendSms(to, body);
  } else {
    logger.warn("OTP_SEND: unknown channel", { channel });
  }
}

async function processNotification(payload: Notification): Promise<void> {
  const { type } = payload;
  if (type === "reserve_alert") {
    const { health, overcollateralizationRatio } = payload;
    const body = renderReserveAlertTemplate(health, overcollateralizationRatio);
    const adminEmail = process.env.NOTIFICATION_ALERT_EMAIL;
    if (adminEmail) await sendEmail(adminEmail, "ACBU Reserve Alert", body);
    else logger.info("Reserve alert (no NOTIFICATION_ALERT_EMAIL)", { health });
    return;
  }
  if (type === "withdrawal_status") {
    const { userId, status, currency, amount, channel: channels } = payload;
    const body = renderWithdrawalStatusTemplate(status, currency, amount);
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, phoneE164: true },
      });
      if (channels.includes("email") && user?.email)
        await sendEmail(user.email, "ACBU Withdrawal Update", body);
      if (channels.includes("sms") && user?.phoneE164) await sendSms(user.phoneE164, body);
    }
    return;
  }
  if (type === "investment_withdrawal_ready") {
    const { userId = null, organizationId = null, amountAcbu } = payload;
    const body = renderInvestmentWithdrawalReadyTemplate(amountAcbu);

    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, phoneE164: true },
      });
      if (user?.email) await sendEmail(user.email, "Your investment withdrawal is ready", body);
      if (user?.phoneE164) await sendSms(user.phoneE164, body);
    }

    if (organizationId) {
      const orgUsers = await prisma.user.findMany({
        where: { organizationId },
        select: { email: true, phoneE164: true },
      });
      const emailBatch = orgUsers
        .filter((u: { email: string | null; phoneE164: string | null }) => u.email !== null)
        .map((u: { email: string | null; phoneE164: string | null }) => ({
          to: u.email as string,
          subject: "Organization investment withdrawal is ready",
          body,
        }));

      if (emailBatch.length > 0) {
        await sendEmailBatch(emailBatch);
      }

      for (const u of orgUsers) {
        if (u.phoneE164) await sendSms(u.phoneE164, body);
      }
    }
    return;
  }
  logger.debug("Notification type not handled", { type });
}

export async function startNotificationConsumer(): Promise<void> {
  const ch = await connectRabbitMQ();
  ch.prefetch(2);

  await assertQueueWithDLQ(QUEUES.OTP_SEND);
  ch.consume(
    QUEUES.OTP_SEND,
    async (msg: ConsumeMessage | null) => {
      if (!msg) return;
      const headers = msg.properties.headers ?? {};
      const retries = typeof headers["x-retries"] === "number" ? headers["x-retries"] : 0;

      try {
        // Validate OTP send message
        const validatedPayload = parseIncomingMessage<OtpSend>(QUEUES.OTP_SEND, msg.content);
        await processOtpSend(validatedPayload);
        ch.ack(msg);
      } catch (e) {
        if (e instanceof MessageValidationError) {
          logger.error("OTP_SEND validation failed, sending to DLQ", {
            errors: e.validationErrors,
          });
          await deadLetterMessage(QUEUES.OTP_SEND, msg.content, `Validation failed: ${e.message}`);
          ch.ack(msg);
          return;
        }

        logger.error("OTP_SEND consumer error", { error: e });
        const maxRetries = getQueueMaxRetries(QUEUES.OTP_SEND);
        if (retries >= maxRetries) {
          logger.error("OTP_SEND failed permanently, sending to DLQ", { retries });
          ch.nack(msg, false, false);
          return;
        }
        ch.sendToQueue(QUEUES.OTP_SEND, msg.content, {
          persistent: true,
          headers: { ...headers, "x-retries": retries + 1 },
        });
        ch.ack(msg);
      }
    },
    { noAck: false },
  );

  await assertQueueWithDLQ(QUEUES.NOTIFICATIONS);
  ch.consume(
    QUEUES.NOTIFICATIONS,
    async (msg: ConsumeMessage | null) => {
      if (!msg) return;
      const headers = msg.properties.headers ?? {};
      const retries = typeof headers["x-retries"] === "number" ? headers["x-retries"] : 0;

      try {
        // Validate notification message
        const validatedPayload = parseIncomingMessage<Notification>(
          QUEUES.NOTIFICATIONS,
          msg.content,
        );
        await processNotification(validatedPayload);
        ch.ack(msg);
      } catch (e) {
        if (e instanceof MessageValidationError) {
          logger.error("NOTIFICATIONS validation failed, sending to DLQ", {
            errors: e.validationErrors,
          });
          await deadLetterMessage(
            QUEUES.NOTIFICATIONS,
            msg.content,
            `Validation failed: ${e.message}`,
          );
          ch.ack(msg);
          return;
        }

        logger.error("NOTIFICATIONS consumer error", { error: e });
        const maxRetries = getQueueMaxRetries(QUEUES.NOTIFICATIONS);
        if (retries >= maxRetries) {
          logger.error("NOTIFICATIONS failed permanently, sending to DLQ", { retries });
          ch.nack(msg, false, false);
          return;
        }
        ch.sendToQueue(QUEUES.NOTIFICATIONS, msg.content, {
          persistent: true,
          headers: { ...headers, "x-retries": retries + 1 },
        });
        ch.ack(msg);
      }
    },
    { noAck: false },
  );

  logger.info("Notification consumer started with validation", {
    queues: [QUEUES.OTP_SEND, QUEUES.NOTIFICATIONS],
  });
}
