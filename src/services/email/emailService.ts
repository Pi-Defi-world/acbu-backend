import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../../config/env";
import { logger } from "../../config/logger";

export type SmtpEmailMessage = {
  to: string;
  subject: string;
  body: string;
};

export type SmtpPoolMetrics = {
  activeTransports: number;
  batchesInFlight: number;
  totalBatchesCompleted: number;
  totalConnectionsClosed: number;
  leakedTransportWarnings: number;
};

const poolMetrics: SmtpPoolMetrics = {
  activeTransports: 0,
  batchesInFlight: 0,
  totalBatchesCompleted: 0,
  totalConnectionsClosed: 0,
  leakedTransportWarnings: 0,
};

function getSmtpConfig() {
  return config.notification.smtp;
}

function createSmtpTransport(): Transporter {
  const smtp = getSmtpConfig();
  if (!smtp.host) {
    throw new Error("SMTP_HOST is required when NOTIFICATION_EMAIL_PROVIDER=smtp");
  }

  const transport = nodemailer.createTransport({
    pool: true,
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth:
      smtp.user && smtp.pass
        ? {
            user: smtp.user,
            pass: smtp.pass,
          }
        : undefined,
    maxConnections: smtp.maxConnections,
    maxMessages: smtp.maxMessages,
  });

  poolMetrics.activeTransports += 1;
  return transport;
}

async function closeSmtpTransport(transport: Transporter, context: string): Promise<void> {
  try {
    if (!transport.isIdle()) {
      logger.warn("SMTP transport not idle before close", { context });
    }

    await transport.close();
    poolMetrics.totalConnectionsClosed += 1;
  } catch (error) {
    poolMetrics.leakedTransportWarnings += 1;
    logger.error("Failed to close SMTP transport", { context, error });
    throw error;
  } finally {
    poolMetrics.activeTransports = Math.max(0, poolMetrics.activeTransports - 1);
  }
}

function recordPoolLeakIfDetected(context: string): void {
  if (poolMetrics.activeTransports > 0) {
    poolMetrics.leakedTransportWarnings += 1;
    logger.warn("SMTP transport pool leak detected", {
      context,
      metrics: getSmtpPoolMetrics(),
    });
  }
}

export function getSmtpPoolMetrics(): SmtpPoolMetrics {
  return { ...poolMetrics };
}

/** Reset pool metrics (for tests). */
export function resetSmtpPoolMetrics(): void {
  poolMetrics.activeTransports = 0;
  poolMetrics.batchesInFlight = 0;
  poolMetrics.totalBatchesCompleted = 0;
  poolMetrics.totalConnectionsClosed = 0;
  poolMetrics.leakedTransportWarnings = 0;
}

export async function sendSmtpEmailBatch(messages: SmtpEmailMessage[]): Promise<void> {
  if (messages.length === 0) {
    return;
  }

  poolMetrics.batchesInFlight += 1;
  const transport = createSmtpTransport();

  try {
    for (const message of messages) {
      await transport.sendMail({
        from: config.notification.emailFrom,
        to: message.to,
        subject: message.subject,
        text: message.body,
      });
    }
  } finally {
    await closeSmtpTransport(transport, "batch");
    poolMetrics.batchesInFlight -= 1;
    poolMetrics.totalBatchesCompleted += 1;
    recordPoolLeakIfDetected("batch");
  }
}

export async function sendSmtpEmail(to: string, subject: string, body: string): Promise<void> {
  await sendSmtpEmailBatch([{ to, subject, body }]);
}
