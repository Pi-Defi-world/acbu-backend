/**
 * NotificationService: email (SendGrid/SES) and SMS (Twilio/AfricasTalking).
 * When provider is 'log', only logs; when API keys are set, sends via provider.
 *
 * --- DOMAIN AUTHENTICATION REQUIREMENTS (DNS) ---
 * To ensure deliverability and avoid spam filters, ensure the following records
 * are set for the verified domain (e.g., acbu.io):
 *
 * 1. SPF: v=spf1 include:sendgrid.net include:amazonses.com ~all
 * 2. DKIM: Follow provider-specific instructions to add CNAME/TXT records.
 * 3. DMARC: v=DMARC1; p=quarantine; adkim=s; aspf=s;
 * 4. Verified "From" Address: Must match the authenticated domain.
 */
import axios from "axios";
import { config } from "../../config/env";
import { logger } from "../../config/logger";
import { sendSmtpEmail, sendSmtpEmailBatch, type SmtpEmailMessage } from "../email";

const cfg = config.notification;

export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  if (cfg.emailProvider === "smtp") {
    try {
      await sendSmtpEmail(to, subject, body);
      logger.info("Email sent via SMTP", { to: to ? "***" : undefined });
    } catch (e) {
      logger.error("SMTP send failed", { error: e });
      throw e;
    }
    return;
  }
  if (cfg.emailProvider === "log") {
    logger.info("NotificationService (email log)", {
      to: process.env.NODE_ENV === "production" ? (to ? "***" : undefined) : to,
      subject,
      body,
    });
    return;
  }
  if (cfg.emailProvider === "sendgrid" && cfg.sendgridApiKey) {
    try {
      // `to` may be a single address or a comma-separated list (see
      // weightDriftAuditJob.ts, which joins multiple configured admin
      // recipients this way). SendGrid's API requires each recipient as its
      // own { email } object in the array — passing the whole joined string
      // as a single object's `email` field sends one malformed address
      // instead of delivering to every recipient.
      const recipients = to
        .split(",")
        .map((address) => address.trim())
        .filter((address) => address.length > 0)
        .map((email) => ({ email }));

      await axios.post(
        "https://api.sendgrid.com/v3/mail/send",
        {
          personalizations: [{ to: recipients }],
          from: {
            email: cfg.emailFrom,
            name: "ACBU",
          },
          subject,
          content: [{ type: "text/plain", value: body }],
        },
        {
          headers: {
            Authorization: `Bearer ${cfg.sendgridApiKey}`,
            "Content-Type": "application/json",
          },
        },
      );
      logger.info("Email sent via SendGrid", {
        to: to ? "***" : undefined,
        recipientCount: recipients.length,
      });
    } catch (e) {
      logger.error("SendGrid send failed", { error: e });
      throw e;
    }
    return;
  }
  if (cfg.emailProvider === "ses" && cfg.sesAccessKeyId && cfg.sesSecretAccessKey) {
    try {
      // AWS SigV4 signing is complex to implement manually.
      // For reliability and production readiness, we recommend installing @aws-sdk/client-ses.
      // Example command: pnpm add @aws-sdk/client-ses
      logger.warn(
        "SES provider configured but @aws-sdk/client-ses is recommended for production SigV4 signing.",
        {
          to: to ? "***" : undefined,
        },
      );

      // Placeholder for actual SDK call or signed request
      throw new Error("SES provider requires @aws-sdk/client-ses for secure communication.");
    } catch (e) {
      logger.error("SES send failed (check credentials and domain verification)", {
        error: e,
      });
      throw e;
    }
    return;
  }
  logger.info("NotificationService (email log)", {
    to: to ? "***" : undefined,
    subject,
  });
}

export async function sendEmailBatch(messages: SmtpEmailMessage[]): Promise<void> {
  if (messages.length === 0) {
    return;
  }

  if (cfg.emailProvider === "smtp") {
    try {
      await sendSmtpEmailBatch(messages);
      logger.info("Email batch sent via SMTP", { count: messages.length });
    } catch (e) {
      logger.error("SMTP batch send failed", { error: e, count: messages.length });
      throw e;
    }
    return;
  }

  for (const message of messages) {
    await sendEmail(message.to, message.subject, message.body);
  }
}

export async function sendSms(to: string, body: string): Promise<void> {
  if (cfg.smsProvider === "log") {
    logger.info("NotificationService (SMS log)", {
      to: to ? "***" : undefined,
    });
    return;
  }
  if (
    cfg.smsProvider === "twilio" &&
    cfg.twilioAccountSid &&
    cfg.twilioAuthToken &&
    cfg.twilioFromNumber
  ) {
    try {
      const auth = Buffer.from(`${cfg.twilioAccountSid}:${cfg.twilioAuthToken}`).toString("base64");
      await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${cfg.twilioAccountSid}/Messages.json`,
        new URLSearchParams({
          To: to,
          From: cfg.twilioFromNumber,
          Body: body,
        }),
        {
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        },
      );
      logger.info("SMS sent via Twilio", { to: to ? "***" : undefined });
    } catch (e) {
      logger.error("Twilio send failed", { error: e });
      throw e;
    }
    return;
  }
  if (
    cfg.smsProvider === "africas_talking" &&
    cfg.africasTalkingApiKey &&
    cfg.africasTalkingUsername
  ) {
    logger.warn("AfricasTalking provider not implemented; logging only", {
      to: to ? "***" : undefined,
    });
    return;
  }
  logger.info("NotificationService (SMS log)", { to: to ? "***" : undefined });
}

export function renderOtpTemplate(code: string): string {
  return `Your ACBU verification code is: ${code}. Valid for 10 minutes.`;
}

export function renderWithdrawalStatusTemplate(
  status: string,
  currency: string,
  amount: number,
): string {
  return `Your ACBU withdrawal of ${amount} ${currency} has been ${status}.`;
}

export function renderInvestmentWithdrawalReadyTemplate(amountAcbu: number): string {
  return `Your investment withdrawal of ${amountAcbu} ACBU is now available. You can complete the transfer or burn from your wallet.`;
}

export function renderReserveAlertTemplate(health: string, ratio: number): string {
  return `ACBU reserve alert: health=${health}, overcollateralization ratio=${ratio.toFixed(2)}%.`;
}
