/**
 * POST /v1/webhooks/flutterwave - Receive Flutterwave webhooks (deposits, etc.).
 * Verifies signature (verif-hash = HMAC-SHA256 of raw body with FLUTTERWAVE_WEBHOOK_SECRET).
 */
import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { config } from "../config/env";
import { logger } from "../config/logger";
import { prisma } from "../config/database";

export function verifyFlutterwaveSignature(
  req: Request & { rawBody?: Buffer },
  res: Response,
  next: NextFunction,
): void {
  const secret = config.flutterwave.webhookSecret;
  if (!secret) {
    logger.error(
      "FLUTTERWAVE_WEBHOOK_SECRET is not configured — rejecting webhook. " +
        "Set the environment variable to accept Flutterwave webhooks.",
    );
    res.status(503).json({
      error: "Webhook verification unavailable: secret not configured",
    });
    return;
  }
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    res.status(400).json({ error: "Raw body required for verification" });
    return;
  }
  const received = req.headers["verif-hash"] as string | undefined;
  if (!received) {
    res.status(401).json({ error: "Missing verif-hash header" });
    return;
  }
  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  try {
    if (
      crypto.timingSafeEqual(
        Buffer.from(received, "hex"),
        Buffer.from(computed, "hex"),
      )
    ) {
      next();
      return;
    }
  } catch {
    // length mismatch etc.
  }
  logger.warn("Flutterwave webhook signature mismatch");
  res.status(401).json({ error: "Invalid signature" });
}

// ── Paystack Webhook ────────────────────────────────────────────────────────

/**
 * Verify Paystack webhook signature using HMAC-SHA512 of the raw body.
 * Rejects the request if PAYSTACK_SECRET_KEY is not configured.
 */
export function verifyPaystackSignature(
  req: Request & { rawBody?: Buffer },
  res: Response,
  next: NextFunction,
): void {
  const secret = config.paystack.secretKey;
  if (!secret) {
    logger.error(
      "PAYSTACK_SECRET_KEY is not configured — rejecting webhook. " +
        "Set the environment variable to accept Paystack webhooks.",
    );
    res.status(503).json({
      error: "Webhook verification unavailable: secret not configured",
    });
    return;
  }
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    res.status(400).json({ error: "Raw body required for verification" });
    return;
  }
  const received = req.headers["x-paystack-signature"] as string | undefined;
  if (!received) {
    res.status(401).json({ error: "Missing x-paystack-signature header" });
    return;
  }
  const computed = crypto
    .createHmac("sha512", secret)
    .update(rawBody)
    .digest("hex");
  if (computed === received) {
    next();
    return;
  }
  logger.warn("Paystack webhook signature mismatch");
  res.status(401).json({ error: "Invalid signature" });
}

/**
 * Handle Paystack webhook payload: persist and optionally process transaction.
 */
export async function handlePaystackWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const payload = req.body as {
      event?: string;
      data?: {
        id?: number;
        reference?: string;
        amount?: number;
        currency?: string;
        status?: string;
        customer?: { email?: string };
      };
    };
    const eventType = payload.event ?? "unknown";
    const data = payload.data ?? {};
    logger.info("Paystack webhook received", {
      eventType,
      reference: data.reference,
      status: data.status,
    });

    await prisma.webhook.create({
      data: {
        eventType: `paystack:${String(eventType)}`,
        payload: payload as object,
        status: "processed",
      },
    });

    if (eventType === "charge.success" && data.status === "success") {
      // Optional: create or update Transaction for deposit (mint flow)
      // When reference links to a pending mint, update transaction
    }

    res.status(200).json({ status: "ok" });
  } catch (error) {
    next(error);
  }
}

/**
 * Handle Flutterwave webhook payload: persist and optionally create/update transaction.
 */
export async function handleFlutterwaveWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const payload = req.body as {
      event?: string;
      type?: string;
      data?: {
        id?: number;
        tx_ref?: string;
        flw_ref?: string;
        amount?: number;
        currency?: string;
        status?: string;
        customer?: { email?: string };
      };
    };
    const eventType = payload.event ?? payload.type ?? "unknown";
    const data = payload.data ?? {};
    logger.info("Flutterwave webhook received", {
      eventType,
      tx_ref: data.tx_ref,
      status: data.status,
    });

    await prisma.webhook.create({
      data: {
        eventType: String(eventType),
        payload: payload as object,
        status: "processed",
      },
    });

    if (eventType === "charge.completed" || data.status === "successful") {
      // Optional: create or update Transaction for deposit (mint flow)
      // When tx_ref links to a pending mint, update transaction and reserve history
      // For now we only log and persist the webhook
    }

    res.status(200).json({ status: "ok" });
  } catch (error) {
    next(error);
  }
}
