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

const cfg = config.notification;

export async function sendEmail(
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  if (cfg.emailProvider === "log") {
    logger.info("NotificationService (email log)", {
      to: to ? "***" : undefined,
      subject,
    });
    return;
  }
  if (cfg.emailProvider === "sendgrid" && cfg.sendgridApiKey) {
    try {
      await axios.post(
        "https://api.sendgrid.com/v3/mail/send",
        {
          personalizations: [{ to: [{ email: to }] }],
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
      logger.info("Email sent via SendGrid", { to: to ? "***" : undefined });
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
      logger.warn("SES provider configured but @aws-sdk/client-ses is recommended for production SigV4 signing.", {
        to: to ? "***" : undefined,
      });

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
      const auth = Buffer.from(
        `${cfg.twilioAccountSid}:${cfg.twilioAuthToken}`,
      ).toString("base64");
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

export function renderInvestmentWithdrawalReadyTemplate(
  amountAcbu: number,
): string {
  return `Your investment withdrawal of ${amountAcbu} ACBU is now available. You can complete the transfer or burn from your wallet.`;
}

export function renderReserveAlertTemplate(
  health: string,
  ratio: number,
): string {
  return `ACBU reserve alert: health=${health}, overcollateralization ratio=${ratio.toFixed(2)}%.`;
}
