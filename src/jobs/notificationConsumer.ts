/**
 * Consumes OTP_SEND and NOTIFICATIONS queues; sends email/SMS via NotificationService.
 */
import type { ConsumeMessage } from "amqplib";
import { connectRabbitMQ, QUEUES } from "../config/rabbitmq";
import { logger } from "../config/logger";
import { prisma } from "../config/database";
import {
  sendEmail,
  sendSms,
  renderOtpTemplate,
  renderWithdrawalStatusTemplate,
  renderReserveAlertTemplate,
  renderInvestmentWithdrawalReadyTemplate,
} from "../services/notification";

interface OtpSendPayload {
  channel: string;
  to: string;
  code: string;
}

interface NotificationPayload {
  type: string;
  [key: string]: unknown;
}

async function processOtpSend(payload: OtpSendPayload): Promise<void> {
  const { channel, to, code } = payload;
  if (!to || !code) {
    logger.warn("OTP_SEND: missing to or code", { hasTo: !!to });
    return;
  }
  const body = renderOtpTemplate(code);
  if (channel === "email") {
    await sendEmail(to, "Your ACBU verification code", body);
  } else if (channel === "sms") {
    await sendSms(to, body);
  } else {
    logger.warn("OTP_SEND: unknown channel", { channel });
  }
}

async function processNotification(
  payload: NotificationPayload,
): Promise<void> {
  const { type } = payload;
  if (type === "reserve_alert") {
    const health = payload.health as string;
    const overcollateralizationRatio =
      (payload.overcollateralizationRatio as number) ?? 0;
    const body = renderReserveAlertTemplate(health, overcollateralizationRatio);
    const adminEmail = process.env.NOTIFICATION_ALERT_EMAIL;
    if (adminEmail) await sendEmail(adminEmail, "ACBU Reserve Alert", body);
    else logger.info("Reserve alert (no NOTIFICATION_ALERT_EMAIL)", { health });
    return;
  }
  if (type === "withdrawal_status") {
    const userId = payload.userId as string | null;
    const status = payload.status as string;
    const currency = payload.currency as string;
    const amount = payload.amount as number;
    const channels = (payload.channel as string[]) ?? ["email"];
    const body = renderWithdrawalStatusTemplate(status, currency, amount);
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, phoneE164: true },
      });
      if (channels.includes("email") && user?.email)
        await sendEmail(user.email, "ACBU Withdrawal Update", body);
      if (channels.includes("sms") && user?.phoneE164)
        await sendSms(user.phoneE164, body);
    }
    return;
  }
  if (type === "investment_withdrawal_ready") {
    const userId = payload.userId as string | null;
    const organizationId = payload.organizationId as string | null;
    const amountAcbu = (payload.amountAcbu as number) ?? 0;
    const body = renderInvestmentWithdrawalReadyTemplate(amountAcbu);

    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, phoneE164: true },
      });
      if (user?.email)
        await sendEmail(
          user.email,
          "Your investment withdrawal is ready",
          body,
        );
      if (user?.phoneE164) await sendSms(user.phoneE164, body);
    }

    if (organizationId) {
      const orgUsers = await prisma.user.findMany({
        where: { organizationId },
        select: { email: true, phoneE164: true },
      });
      for (const user of orgUsers) {
        if (user.email)
          await sendEmail(
            user.email,
            "Organization investment withdrawal is ready",
            body,
          );
        if (user.phoneE164) await sendSms(user.phoneE164, body);
      }
    }
    return;
  }
  logger.debug("Notification type not handled", { type });
}

export async function startNotificationConsumer(): Promise<void> {
  const ch = await connectRabbitMQ();
  ch.prefetch(2);

  await ch.assertQueue(QUEUES.OTP_SEND, { durable: true });
  ch.consume(
    QUEUES.OTP_SEND,
    async (msg: ConsumeMessage | null) => {
      if (!msg) return;
      try {
        const payload = JSON.parse(msg.content.toString()) as OtpSendPayload;
        await processOtpSend(payload);
        ch.ack(msg);
      } catch (e) {
        logger.error("OTP_SEND consumer error", { error: e });
        ch.nack(msg, false, true);
      }
    },
    { noAck: false },
  );

  await ch.assertQueue(QUEUES.NOTIFICATIONS, { durable: true });
  ch.consume(
    QUEUES.NOTIFICATIONS,
    async (msg: ConsumeMessage | null) => {
      if (!msg) return;
      try {
        const payload = JSON.parse(
          msg.content.toString(),
        ) as NotificationPayload;
        await processNotification(payload);
        ch.ack(msg);
      } catch (e) {
        logger.error("NOTIFICATIONS consumer error", { error: e });
        ch.nack(msg, false, true);
      }
    },
    { noAck: false },
  );

  logger.info("Notification consumer started", {
    queues: [QUEUES.OTP_SEND, QUEUES.NOTIFICATIONS],
  });
}
