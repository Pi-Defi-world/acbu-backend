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
import { ErrorCodes } from "../types/errorCodes";
import { reconcileBillsWebhook } from "../services/bills";
import type { FinancialEventStatus } from "../types/logging";

// ── Dev/stage mock bypass ────────────────────────────────────────────────────
// When WEBHOOK_SIGNATURE_BYPASS=true AND NODE_ENV is not production,
// signature verification is skipped entirely. This allows local development
// and CI environments to send test payloads without real secrets.
// Never set this variable in production — the boot guard in env.ts will
// reject a missing secret before this code is even reached.
const isDev = config.nodeEnv !== "production";
const bypassEnabled = isDev && process.env.WEBHOOK_SIGNATURE_BYPASS === "true";

// Maximum allowed clock drift in seconds between the webhook timestamp and server time.
// Rejects replayed webhooks that fall outside this window. Default: 300 s (±5 min).
const WEBHOOK_TIMESTAMP_TOLERANCE_S = parseInt(
  process.env.WEBHOOK_TIMESTAMP_TOLERANCE_S || "300",
  10,
);

/**
 * Validate a webhook timestamp (Unix seconds or ISO-8601) against server time.
 * Returns false if the timestamp is absent, unparseable, or outside the tolerance window.
 */
function isTimestampValid(raw: string | undefined): boolean {
  if (!raw) return false;
  const ts = Number(raw);
  const nowS = Date.now() / 1000;
  // Accept plain Unix seconds or ISO-8601 strings
  const eventS = Number.isFinite(ts) ? ts : Date.parse(raw) / 1000;
  if (!Number.isFinite(eventS)) return false;
  return Math.abs(nowS - eventS) <= WEBHOOK_TIMESTAMP_TOLERANCE_S;
}

/**
 * Validate that the request Content-Type is application/json.
 * Rejects requests with multipart/form-data, text/xml, or other content types
 * that could bypass JSON body parsing middleware.
 */
function isContentTypeJson(req: Request): boolean {
  const contentType = req.headers["content-type"];
  if (!contentType) return false;
  // Accept application/json with or without charset parameter
  return contentType.startsWith("application/json");
}

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

  // #296: Enforce Content-Type to prevent bypass of JSON body parsing
  if (!isContentTypeJson(req)) {
    logger.warn("Flutterwave webhook rejected: invalid Content-Type", {
      contentType: req.headers["content-type"],
    });
    res.status(415).json({ error: "Content-Type must be application/json" });
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
      ErrorCodes.CONFIG_ERROR,
    );
  }

  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    res.status(400).json({ error: "Raw body required for verification" });
    return;
  }

  // #390: Reject requests whose timestamp falls outside the tolerance window.
  // Flutterwave sends the event time in the x-flw-timestamp header (Unix seconds).
  const timestamp = req.headers["x-flw-timestamp"] as string | undefined;
  if (!isTimestampValid(timestamp)) {
    logger.warn("Flutterwave webhook timestamp invalid or outside tolerance window", {
      timestamp,
      toleranceS: WEBHOOK_TIMESTAMP_TOLERANCE_S,
    });
    res.status(401).json({ error: "Webhook timestamp invalid or expired" });
    return;
  }

  const received = req.headers["verif-hash"] as string | undefined;
  if (!received) {
    res.status(401).json({ error: "Missing verif-hash header" });
    return;
  }

  const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

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
  if (signatureValid) {
    next();
    return;
  }
  logger.warn("Flutterwave webhook signature mismatch");
  res.status(401).json({ error: "Invalid signature" });
  return;
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

  // #296: Enforce Content-Type to prevent bypass of JSON body parsing
  if (!isContentTypeJson(req)) {
    logger.warn("Paystack webhook rejected: invalid Content-Type", {
      contentType: req.headers["content-type"],
    });
    res.status(415).json({ error: "Content-Type must be application/json" });
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
      ErrorCodes.CONFIG_ERROR,
    );
  }

  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    res.status(400).json({ error: "Raw body required for verification" });
    return;
  }

  // #390: Reject requests whose timestamp falls outside the tolerance window.
  // Paystack sends the event time in the x-paystack-timestamp header (Unix seconds).
  const timestamp = req.headers["x-paystack-timestamp"] as string | undefined;
  if (!isTimestampValid(timestamp)) {
    logger.warn("Paystack webhook timestamp invalid or outside tolerance window", {
      timestamp,
      toleranceS: WEBHOOK_TIMESTAMP_TOLERANCE_S,
    });
    res.status(401).json({ error: "Webhook timestamp invalid or expired" });
    return;
  }

  const received = req.headers["x-paystack-signature"] as string | undefined;
  if (!received) {
    res.status(401).json({ error: "Missing x-paystack-signature header" });
    return;
  }

  const computed = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");

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
  next();
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
      (req.headers["x-request-id"] as string | undefined) ?? crypto.randomUUID();

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
    const flwFinancialStatus: FinancialEventStatus = flwStatusMap[data.status ?? ""] ?? "pending";
    const flwCorrelationId =
      (req.headers["x-request-id"] as string | undefined) ?? crypto.randomUUID();

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

// ── Bills Webhook ───────────────────────────────────────────────────────────

/**
 * Verify bills webhook signature using HMAC-SHA256 of the raw body.
 * Rejects the request if BILLS_WEBHOOK_SECRET is not configured.
 */
export function verifyBillsWebhookSignature(
  req: Request & { rawBody?: Buffer },
  res: Response,
  next: NextFunction,
): void {
  // Dev/stage explicit bypass — never reachable in production because env.ts
  // throws before the server starts when BILLS_WEBHOOK_SECRET is unset.
  if (bypassEnabled) {
    logger.warn("Bills webhook signature check bypassed (dev/stage)");
    next();
    return;
  }

  // #296: Enforce Content-Type to prevent bypass of JSON body parsing
  if (!isContentTypeJson(req)) {
    logger.warn("Bills webhook rejected: invalid Content-Type", {
      contentType: req.headers["content-type"],
    });
    res.status(415).json({ error: "Content-Type must be application/json" });
    return;
  }

  const secret = config.bills.webhookSecret;
  if (!secret) {
    // Should never be reached in production due to boot guard in env.ts.
    logger.error(
      "BILLS_WEBHOOK_SECRET is not configured — rejecting webhook. " +
        "Set the environment variable to accept bills webhooks.",
    );
    throw new AppError(
      "Webhook verification unavailable: secret not configured",
      503,
      ErrorCodes.CONFIG_ERROR,
    );
  }

  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    throw new AppError("Raw body required for verification", 400, ErrorCodes.RAW_BODY_REQUIRED);
  }

  const timestamp = req.headers["x-bills-timestamp"] as string | undefined;
  if (!isTimestampValid(timestamp)) {
    logger.warn("Bills webhook timestamp invalid or outside tolerance window", {
      timestamp,
      toleranceS: WEBHOOK_TIMESTAMP_TOLERANCE_S,
    });
    res.status(401).json({ error: "Webhook timestamp invalid or expired" });
    return;
  }

  const received = req.headers["x-bills-signature"] as string | undefined;
  if (!received) {
    throw new AppError("Missing x-bills-signature header", 401, ErrorCodes.MISSING_SIGNATURE);
  }

  const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

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
    logger.warn("Bills webhook signature mismatch");
    throw new AppError("Invalid signature", 401, ErrorCodes.INVALID_SIGNATURE);
  }
  next();
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

    // Reject requests whose timestamp falls outside the tolerance window
    // (same replay protection used by Flutterwave/Paystack webhooks).
    const timestamp = req.headers["x-bills-timestamp"] as string | undefined;
    if (!isTimestampValid(timestamp)) {
      logger.warn("Bills webhook timestamp invalid or outside tolerance window", {
        timestamp,
        toleranceS: WEBHOOK_TIMESTAMP_TOLERANCE_S,
      });
      res.status(401).json({ error: "Webhook timestamp invalid or expired" });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const transactionId = String(body.transaction_id ?? body.transactionId ?? "").trim();
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
    const reason = body.reason == null ? undefined : String(body.reason).trim() || undefined;

    if (!transactionId) {
      throw new AppError("transaction_id is required", 400);
    }
    if (!providerReference) {
      throw new AppError("provider_reference is required", 400);
    }
    if (!["completed", "failed", "refunded"].includes(status)) {
      throw new AppError("status must be one of completed, failed, refunded", 400);
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
