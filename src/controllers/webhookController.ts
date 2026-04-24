/**
 * POST /v1/webhooks/flutterwave - Receive Flutterwave webhooks (deposits, etc.).
 * Verifies signature (verif-hash = HMAC-SHA256 of raw body with FLUTTERWAVE_WEBHOOK_SECRET).
 *
 * @deprecated Afreum-first / S-token flows: fiat on-ramps are expected via Afreum (or similar)
 * Stellar ramps); these endpoints remain for audit logging only and do not drive minting.
 */
const DEPRECATED_FIAT_WEBHOOK_NOTE =
  "Direct Paystack/Flutterwave deposit webhooks are deprecated in favor of Afreum S-token and on-chain flows. Payload stored for audit only.";

function setFiatWebhookDeprecationHeaders(res: Response): void {
  res.setHeader("Deprecation", "true");
  res.setHeader("Link", '<https://afreum.com>; rel="successor-version"');
}
import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { config } from "../config/env";
import { logger, logFinancialEvent } from "../config/logger";
import { prisma } from "../config/database";
import { AppError } from "../middleware/errorHandler";
import { reconcileBillsWebhook } from "../services/bills";
import type { FinancialEventStatus } from "../types/logging";

// ── Dev/stage mock bypass ────────────────────────────────────────────────────
// When WEBHOOK_SIGNATURE_BYPASS=true AND NODE_ENV is not production,
// signature verification is skipped entirely. This allows local development
// and CI environments to send test payloads without real secrets.
// Never set this variable in production — the boot guard in env.ts will
// reject a missing secret before this code is even reached.
const isDev = config.nodeEnv !== "production";
const bypassEnabled =
  isDev && process.env.WEBHOOK_SIGNATURE_BYPASS === "true";

if (bypassEnabled) {
  logger.warn(
    "WEBHOOK_SIGNATURE_BYPASS is enabled — webhook signature verification " +
      "is DISABLED. This must never be set in production.",
  );
}

// ── Flutterwave Webhook ──────────────────────────────────────────────────────

export function verifyFlutterwaveSignature(
  req: Request & { rawBody?: Buffer },
  res: Response,
  next: NextFunction,
): void {
  // Dev/stage explicit bypass — never reachable in production because env.ts
  // throws before the server starts when FLUTTERWAVE_WEBHOOK_SECRET is unset.
  if (bypassEnabled) {
    logger.warn("Flutterwave webhook signature check bypassed (dev/stage)");
    next();
    return;
  }

  const secret = config.flutterwave.webhookSecret;
  if (!secret) {
    // Should never be reached in production due to boot guard in env.ts.
    // Guards against any future refactor that removes that check.
    logger.error(
      "FLUTTERWAVE_WEBHOOK_SECRET is not configured — rejecting webhook. " +
        "Set the environment variable to accept Flutterwave webhooks.",
    );
    throw new AppError(
      "Webhook verification unavailable: secret not configured",
      503,
      "CONFIG_ERROR",
    );

  }

  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    throw new AppError("Raw body required for verification", 400, "BAD_REQUEST");
  }

  const received = req.headers["verif-hash"] as string | undefined;
  if (!received) {
    throw new AppError("Missing verif-hash header", 401, "UNAUTHORIZED");
  }

  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  // Normalise to equal-length buffers before timingSafeEqual to prevent
  // length-leaking side channels. A mismatched length still fails below.
  const receivedBuf = Buffer.from(received, "hex");
  const computedBuf = Buffer.from(computed, "hex");

  let signatureValid = false;
  if (receivedBuf.length === computedBuf.length) {
    try {
      signatureValid = crypto.timingSafeEqual(receivedBuf, computedBuf);
    } catch {
      // timingSafeEqual throws on length mismatch — belt-and-suspenders.
      signatureValid = false;
    }
  }
  logger.warn("Flutterwave webhook signature mismatch");
  throw new AppError("Invalid signature", 401, "UNAUTHORIZED");
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
  // Dev/stage explicit bypass — never reachable in production because env.ts
  // throws before the server starts when PAYSTACK_SECRET_KEY is unset.
  if (bypassEnabled) {
    logger.warn("Paystack webhook signature check bypassed (dev/stage)");
    next();
    return;
  }

  const secret = config.paystack.secretKey;
  if (!secret) {
    // Should never be reached in production due to boot guard in env.ts.
    logger.error(
      "PAYSTACK_SECRET_KEY is not configured — rejecting webhook. " +
        "Set the environment variable to accept Paystack webhooks.",
    );
    throw new AppError(
      "Webhook verification unavailable: secret not configured",
      503,
      "CONFIG_ERROR",
    );

  }

  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    throw new AppError("Raw body required for verification", 400, "BAD_REQUEST");
  }

  const received = req.headers["x-paystack-signature"] as string | undefined;
  if (!received) {
    throw new AppError("Missing x-paystack-signature header", 401, "UNAUTHORIZED");
  }

  const computed = crypto
    .createHmac("sha512", secret)
    .update(rawBody)
    .digest("hex");

  // Use timing-safe comparison (same pattern as Flutterwave above) to prevent
  // timing side-channel attacks. Paystack previously used string equality (===).
  const receivedBuf = Buffer.from(received, "hex");
  const computedBuf = Buffer.from(computed, "hex");

  let signatureValid = false;
  if (receivedBuf.length === computedBuf.length) {
    try {
      signatureValid = crypto.timingSafeEqual(receivedBuf, computedBuf);
    } catch {
      signatureValid = false;
    }
  }

  if (!signatureValid) {
    logger.warn("Paystack webhook signature mismatch");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }
  logger.warn("Paystack webhook signature mismatch");
  throw new AppError("Invalid signature", 401, "UNAUTHORIZED");
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
    logger.warn("Paystack webhook received (deprecated path)", {
      eventType,
      reference: data.reference,
      status: data.status,
      note: DEPRECATED_FIAT_WEBHOOK_NOTE,
    });

    const paystackStatusMap: Record<string, FinancialEventStatus> = {
      success: "success",
      failed: "failed",
      reversed: "reversed",
    };
    const paystackFinancialStatus: FinancialEventStatus =
      paystackStatusMap[data.status ?? ""] ?? "pending";
    const paystackCorrelationId =
      (req.headers["x-request-id"] as string | undefined) ??
      crypto.randomUUID();

    logFinancialEvent({
      event: "webhook.received",
      provider: "paystack",
      status: paystackFinancialStatus,
      transactionId: data.reference ?? paystackCorrelationId,
      userId: paystackCorrelationId,
      accountId: paystackCorrelationId,
      idempotencyKey: data.reference ?? paystackCorrelationId,
      correlationId: paystackCorrelationId,
      amount: data.amount ?? 0,
      currency: data.currency ?? "NGN",
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

    setFiatWebhookDeprecationHeaders(res);
    res.status(200).json({
      status: "ok",
      deprecated: true,
      message: DEPRECATED_FIAT_WEBHOOK_NOTE,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Handle Flutterwave webhook payload: persist and optionally create/update transaction.
 * @deprecated See module note — audit-only; minting is driven by Stellar/S-token state.
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
    logger.warn("Flutterwave webhook received (deprecated path)", {
      eventType,
      tx_ref: data.tx_ref,
      status: data.status,
      note: DEPRECATED_FIAT_WEBHOOK_NOTE,
    });

    const flwStatusMap: Record<string, FinancialEventStatus> = {
      successful: "success",
      success: "success",
      failed: "failed",
      reversed: "reversed",
    };
    const flwFinancialStatus: FinancialEventStatus =
      flwStatusMap[data.status ?? ""] ?? "pending";
    const flwCorrelationId =
      (req.headers["x-request-id"] as string | undefined) ??
      crypto.randomUUID();

    logFinancialEvent({
      event: "webhook.received",
      provider: "flutterwave",
      status: flwFinancialStatus,
      transactionId: data.tx_ref ?? flwCorrelationId,
      userId: flwCorrelationId,
      accountId: flwCorrelationId,
      idempotencyKey: data.tx_ref ?? flwCorrelationId,
      correlationId: flwCorrelationId,
      amount: data.amount ?? 0,
      currency: data.currency ?? "NGN",
      providerRef: data.flw_ref,
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

    setFiatWebhookDeprecationHeaders(res);
    res.status(200).json({
      status: "ok",
      deprecated: true,
      message: DEPRECATED_FIAT_WEBHOOK_NOTE,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Handle partner bill-payment webhooks and reconcile the existing bill payment transaction.
 * This route is provider-agnostic for now; providers can be added behind the same normalizer.
 */
export async function handleBillsWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const provider = String(req.params.provider || "")
      .trim()
      .toLowerCase();
    if (!provider) {
      throw new AppError("Bills webhook provider is required", 400);
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const transactionId = String(
      body.transaction_id ?? body.transactionId ?? "",
    ).trim();
    const providerReference = String(
      body.provider_reference ?? body.providerReference ?? "",
    ).trim();
    const status = String(body.status ?? "")
      .trim()
      .toLowerCase();
    const amount = Number(body.amount ?? 0);
    const currency = String(body.currency ?? "NGN")
      .trim()
      .toUpperCase();
    const reason =
      body.reason == null ? undefined : String(body.reason).trim() || undefined;

    if (!transactionId) {
      throw new AppError("transaction_id is required", 400);
    }
    if (!providerReference) {
      throw new AppError("provider_reference is required", 400);
    }
    if (!["completed", "failed", "refunded"].includes(status)) {
      throw new AppError(
        "status must be one of completed, failed, refunded",
        400,
      );
    }
    if (!Number.isFinite(amount) || amount < 0) {
      throw new AppError("amount must be a non-negative number", 400);
    }

    const reconciled = await reconcileBillsWebhook({
      provider,
      transactionId,
      providerReference,
      status: status as "completed" | "failed" | "refunded",
      amount,
      currency,
      reason,
      rawPayload: body,
    });

    res.status(200).json({
      ok: true,
      transaction_id: reconciled.transactionId,
      status: reconciled.status,
    });
  } catch (error) {
    next(error);
  }
}