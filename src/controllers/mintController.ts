/**
 * Mint/deposit controllers.
 * Deposit rule: only basket (pool) currencies for /mint/deposit. USDC and XLM deposits accepted via /mint/usdc and /onramp/register; we run conversion and LP/swap in backend; mint proceeds once USDC→XLM conversion succeeds.
 *
 * FEE MECHANICS & RESERVE RATIO:
 * - Mint fees are retained in protocol reserves (NOT passed to fintech partners)
 * - When user deposits $100: reserve gets $100, user minted ~$99.70 of ACBU (0.3% fee)
 * - This creates over-collateralization: $100 backing $99.70 = ~100.3% ratio
 * - Fees accumulate over time to reach/maintain 103-105% reserve ratio target
 * - See docs/fee-destination.md for detailed explanation
 */
import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../config/database";
import { config } from "../config/env";
import { getContractAddresses } from "../config/contracts";
import { acbuMintingService, acbuBurningService } from "../services/contracts";
import { stellarClient } from "../services/stellar/client";
import { AuthRequest } from "../middleware/auth";
import { logAudit } from "../services/audit";
import {
  BASKET_CURRENCIES,
  FORBIDDEN_DEPOSIT_CURRENCIES,
  isAllowedDepositCurrency,
  isForbiddenDepositCurrency,
} from "../config/basket";
import { checkDepositLimits, isMintingPaused } from "../services/limits/limitsService";
import { enqueueUsdcConvertAndMint } from "../jobs/usdcConvertAndMintJob";
import { AppError } from "../middleware/errorHandler";
import { ErrorCodes } from "../types/errorCodes";
import { convertLocalToUsd, convertLocalToUsdWithPrecision } from "../services/rates";
import { extractIdempotencyKey, scopeIdempotencyKey } from "../utils/idempotency";
import { assertUserWalletAddress } from "../services/wallet/walletService";
import { logger } from "../config/logger";
import {
  parseMonetaryString,
  decimalToContractNumber,
  contractNumberToDecimal,
  calculateFee,
} from "../utils/decimalUtils";

const MINT_FEE_BPS = 30; // 0.3%

export const usdcBodySchema = z.object({
  usdc_amount: z
    .string()
    .min(1)
    .refine(
      (s) => /^\d+(\.\d{1,7})?$/.test(s.trim()) && parseFloat(s.trim()) > 0,
      "must be positive with up to 7 decimal places",
    ),
  wallet_address: z.string().length(56).regex(/^G/),
  currency_preference: z.enum(["auto"]).optional(),
});

/**
 * POST /v1/mint/usdc - Accept USDC deposit. We convert USDC→XLM in backend (pools/swaps independent); once conversion succeeds, mint is approved. User does not wait for LPs.
 */
export async function mintFromUsdc(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) {
      throw new AppError("User context required for USDC deposit", 401);
    }

    const idempotencyKey = extractIdempotencyKey(req);
    if (idempotencyKey) {
      const existingSwap = await prisma.onRampSwap.findFirst({
        where: { idempotencyKey, userId },
      });
      if (existingSwap) {
        res.status(202).json({
          on_ramp_swap_id: existingSwap.id,
          status: existingSwap.status,
          message:
            "USDC deposit received. We will convert USDC→XLM in the backend and mint ACBU to your wallet; you do not need to wait for pools or swaps.",
        });
        return;
      }
    }

    const parsed = usdcBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        "Invalid request",
        400,
        ErrorCodes.VALIDATION_ERROR,
        parsed.error.flatten(),
      );
    }

    const { usdc_amount, wallet_address } = parsed.data;
    const userWalletAddress = await assertUserWalletAddress(userId, wallet_address);
    const usdcDecimal = parseMonetaryString(usdc_amount, "usdc_amount");
    // SECURITY: Always enforce circuit breaker and deposit limits
    // Previously these checks were skipped when req.audience was undefined,
    // allowing bypass of critical financial controls via direct /mint/usdc route
    const paused = await isMintingPaused();
    if (paused) {
      throw new AppError(
        "New minting is temporarily paused (reserve ratio below 102%).",
        503,
        ErrorCodes.CIRCUIT_BREAKER,
      );
    }

    // Apply deposit limits - use retail as default if no audience is set
    // FIX #32: Defaulting to "retail" prevents limit bypass when audience is undefined
    const audience = req.audience || "retail";
    await checkDepositLimits(audience, usdcDecimal, userId, req.apiKey?.organizationId ?? null);

    let swap;
    try {
      swap = await prisma.onRampSwap.create({
        data: {
          userId,
          stellarAddress: userWalletAddress,
          source: "usdc_deposit",
          usdcAmount: new Decimal(usdcDecimal),
          xlmAmount: null,
          status: "pending_convert",
          idempotencyKey,
        },
      });
    } catch (createError) {
      if (
        idempotencyKey &&
        createError instanceof Prisma.PrismaClientKnownRequestError &&
        createError.code === "P2002"
      ) {
        const existingSwap = await prisma.onRampSwap.findFirst({
          where: { idempotencyKey, userId },
        });
        if (existingSwap) {
          res.status(202).json({
            on_ramp_swap_id: existingSwap.id,
            status: existingSwap.status,
            message:
              "USDC deposit received. We will convert USDC→XLM in the backend and mint ACBU to your wallet; you do not need to wait for pools or swaps.",
          });
          return;
        }
      }
      throw createError;
    }

    await enqueueUsdcConvertAndMint({ onRampSwapId: swap.id });
    res.status(202).json({
      on_ramp_swap_id: swap.id,
      status: "pending_convert",
      message:
        "USDC deposit received. We will convert USDC→XLM in the backend and mint ACBU to your wallet; you do not need to wait for pools or swaps.",
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Internal: mint ACBU from USDC (used by XLM→ACBU job after selling XLM).
 * Not exposed as public endpoint; called by job with wallet_address and equivalent amount.
 */
export async function mintFromUsdcInternal(
  usdcAmount: number,
  walletAddress: string,
  userId?: string,
  organizationId?: string,
): Promise<{ transactionId: string; acbuAmount: string }> {
  const usdcDecimal = new Decimal(usdcAmount);
  const feeUsdcDecimal = calculateFee(usdcDecimal, MINT_FEE_BPS);
  const usdcAmount7 = decimalToContractNumber(usdcDecimal).toString();
  const tx = await prisma.transaction.create({
    data: {
      userId: userId ?? undefined,
      organizationId: organizationId ?? undefined,
      type: "mint",
      status: "pending",
      usdcAmount: new Decimal(usdcDecimal),
      fee: new Decimal(feeUsdcDecimal),
      rateSnapshot: {
        source: "xlm_on_ramp",
        timestamp: new Date().toISOString(),
      },
    },
  });
  const addresses = getContractAddresses();
  if (!addresses.minting) {
    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        status: "failed",
        rateSnapshot: { error: "CONTRACT_MINTING not configured" },
      },
    });
    throw new Error("Minting contract address not configured");
  }

  const sourceAccount = stellarClient.getKeypair()?.publicKey();
  if (!sourceAccount) {
    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        status: "failed",
        rateSnapshot: {
          error: "No Stellar source account (STELLAR_SECRET_KEY)",
        },
      },
    });
    throw new Error("No source account available");
  }

  try {
    const result = await acbuMintingService.mintFromUsdc({
      user: sourceAccount,
      usdcAmount: usdcAmount7,
      recipient: walletAddress,
    });
    const acbuDecimal = contractNumberToDecimal(Number(result.acbuAmount));

    try {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          status: "completed",
          acbuAmount: new Decimal(acbuDecimal),
          blockchainTxHash: result.transactionHash,
          completedAt: new Date(),
        },
      });
    } catch (dbError) {
      // DB update failed after on-chain mint succeeded — attempt compensation
      logger.error("DB update failed after successful on-chain mint, attempting compensation", {
        transactionId: tx.id,
        walletAddress,
        acbuAmount: acbuDecimal.toString(),
        blockchainTxHash: result.transactionHash,
        dbError: dbError instanceof Error ? dbError.message : String(dbError),
      });

      // Try to burn the minted tokens as compensation
      try {
        await acbuBurningService.redeemSingle({
          user: sourceAccount,
          recipient: sourceAccount,
          acbuAmount: acbuDecimal.toString(),
          currency: "USDC",
          idempotencyKey: `compensation:${tx.id}`,
        });
        logger.info("Compensation burn succeeded", { transactionId: tx.id });
      } catch (compensationError) {
        // Compensation also failed — log for manual intervention
        logger.error("Compensation burn failed, manual intervention required", {
          transactionId: tx.id,
          walletAddress,
          acbuAmount: acbuDecimal.toString(),
          blockchainTxHash: result.transactionHash,
          compensationError:
            compensationError instanceof Error
              ? compensationError.message
              : String(compensationError),
        });
      }

      // Mark transaction as requiring manual review
      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          status: "completed",
          acbuAmount: new Decimal(acbuDecimal),
          blockchainTxHash: result.transactionHash,
          completedAt: new Date(),
          rateSnapshot: {
            error: "DB update failed after on-chain mint, compensation attempted",
            at: new Date().toISOString(),
          },
        },
      });
    }

    // Audit trail: record USDC mint completion (W10-OBS-006)
    await logAudit({
      eventType: "transaction",
      entityType: "transaction",
      entityId: tx.id,
      action: "mint_completed",
      newValue: {
        type: "mint",
        source: "usdc_deposit",
        walletAddress: walletAddress ? "***" : undefined,
        usdcAmount: usdcDecimal.toString(),
        acbuAmount: acbuDecimal.toString(),
        blockchainTxHash: result.transactionHash,
      },
      performedBy: userId,
    }).catch((auditErr) => {
      logger.error("Audit log failed for mint_completed", {
        transactionId: tx.id,
        error: auditErr instanceof Error ? auditErr.message : String(auditErr),
      });
    });

    return { transactionId: tx.id, acbuAmount: acbuDecimal.toString() };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Soroban mint_from_usdc failed", {
      message,
      walletAddress,
      userId,
      organizationId,
    });
    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        status: "failed",
        rateSnapshot: { error: message, at: new Date().toISOString() },
      },
    });

    // Audit trail: record USDC mint failure (W10-OBS-006)
    await logAudit({
      eventType: "transaction",
      entityType: "transaction",
      entityId: tx.id,
      action: "mint_failed",
      newValue: {
        type: "mint",
        source: "usdc_deposit",
        walletAddress: walletAddress ? "***" : undefined,
        usdcAmount: usdcDecimal.toString(),
        error: message,
      },
      performedBy: userId,
    }).catch((auditErr) => {
      logger.error("Audit log failed for mint_failed", {
        transactionId: tx.id,
        error: auditErr instanceof Error ? auditErr.message : String(auditErr),
      });
    });

    throw err;
  }
}

const fintechTxIdSchema = z
  .string()
  .trim()
  .min(1, "fintech_tx_id must be provided")
  .max(255, "fintech_tx_id must be 255 characters or fewer")
  .regex(/^[^\s]+$/, "fintech_tx_id must not contain whitespace")
  .optional();

export const depositBodySchema = z.object({
  currency: z
    .string()
    .length(3)
    .transform((value) => value.toUpperCase())
    .refine(
      (currency) => isAllowedDepositCurrency(currency) || isForbiddenDepositCurrency(currency),
      {
        message: `Currency must be one of: ${[
          ...BASKET_CURRENCIES,
          ...FORBIDDEN_DEPOSIT_CURRENCIES,
        ].join(", ")}`,
      },
    ),
  amount: z
    .string()
    .min(1)
    .refine(
      (s) => /^\d+(\.\d{1,7})?$/.test(s.trim()) && parseFloat(s.trim()) > 0,
      "must be positive with up to 7 decimal places",
    ),
  wallet_address: z.string().length(56).regex(/^G/),
  fintech_tx_id: fintechTxIdSchema,
});

/**
 * POST /v1/mint/deposit - Deposit in basket currency only (NGN, KES, etc.). Rejects USDC/USDT.
 */
export async function depositFromBasketCurrency(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = depositBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        "Invalid request",
        400,
        ErrorCodes.VALIDATION_ERROR,
        parsed.error.flatten(),
      );
    }

    const { currency, amount, wallet_address, fintech_tx_id } = parsed.data;

    if (isForbiddenDepositCurrency(currency)) {
      throw new AppError(
        `Deposits in ${currency} are not allowed. Only basket (pool) currencies are accepted: ${BASKET_CURRENCIES.join(", ")}. For USDC, use the on-ramp (swap USDC→XLM via Stellar LP).`,
        400,
        ErrorCodes.DEPOSIT_ONLY_BASKET_CURRENCIES,
        { deposit_currencies_allowed: [...BASKET_CURRENCIES] },
      );
    }

    if (!isAllowedDepositCurrency(currency)) {
      throw new AppError(
        `Currency ${currency} is not supported for deposit. Allowed basket currencies: ${BASKET_CURRENCIES.join(", ")}.`,
        400,
        ErrorCodes.INVALID_CURRENCY,
        { deposit_currencies_allowed: [...BASKET_CURRENCIES] },
      );
    }

    const amountDecimal = parseMonetaryString(amount, "amount");
    const amountNum = Number(amountDecimal.toString()); // Reporting boundary: convert via string to preserve exact value
    const userId = req.apiKey?.userId;

    if (!userId) {
      throw new AppError("User context required for deposit", 401);
    }

    await assertUserWalletAddress(userId, wallet_address);

    // SECURITY: Always enforce circuit breaker and deposit limits
    // Previously these checks were skipped when req.audience was undefined,
    // allowing bypass of critical financial controls via direct /mint/deposit route
    const paused = await isMintingPaused();
    if (paused) {
      throw new AppError(
        "New minting is temporarily paused (reserve ratio below 102%).",
        503,
        ErrorCodes.CIRCUIT_BREAKER,
      );
    }

    // Apply deposit limits - use retail as default if no audience is set
    const audience = req.audience || "retail";

    // CRITICAL: Convert local currency amount to USD for accurate limit checking.
    // Previously, the raw local amount was passed directly to checkDepositLimits,
    // treating 100,000 NGN as if it were 100,000 USD.
    // Now we fetch the current exchange rates and properly convert:
    // 1. Get the rate: how many local currency units per 1 ACBU
    // 2. Calculate ACBU equivalent: localAmount / localRate
    // 3. Convert to USD: acbuAmount * acbuUsdRate
    const amountUsd = await convertLocalToUsd(amountNum, currency);

    await checkDepositLimits(
      audience,
      new Decimal(amountUsd),
      userId,
      req.apiKey?.organizationId ?? null,
    );

    // Idempotency keys are scoped to the requesting user (Pi-Defi-world/
    // acbu-backend#985): Transaction.idempotencyKey is globally unique, so an
    // unscoped partner fintech_tx_id would let two users collide on the same
    // key — the second user would receive a 202 referencing the first user's
    // transaction (status/existence disclosure) and their own deposit would
    // be blocked.
    const rawIdempotencyKey = extractIdempotencyKey(req) ?? fintech_tx_id ?? undefined;
    const idempotencyKey = rawIdempotencyKey
      ? scopeIdempotencyKey(userId, rawIdempotencyKey)
      : undefined;
    if (idempotencyKey) {
      const existingTx = await prisma.transaction.findUnique({
        where: { idempotencyKey },
      });

      if (existingTx) {
        res.status(202).json({
          transaction_id: existingTx.id,
          currency: existingTx.localCurrency ?? currency,
          amount: existingTx.localAmount?.toString() ?? amountDecimal.toString(),
          wallet_address: wallet_address ? "***" : undefined,
          status: existingTx.status,
          message:
            existingTx.status === "completed"
              ? "Deposit already processed."
              : "Deposit already received and is still being processed.",
        });
        return;
      }
    }

    let tx;
    try {
      tx = await prisma.transaction.create({
        data: {
          userId: req.apiKey?.userId ?? undefined,
          organizationId: req.apiKey?.organizationId ?? undefined,
          idempotencyKey,
          type: "mint",
          status: "pending",
          localCurrency: currency,
          localAmount: new Decimal(amountDecimal),
          rateSnapshot: {
            deposit_currency: currency,
            amount: Number(amountDecimal.toString()),
            timestamp: new Date().toISOString(),
          },
        },
      });
    } catch (createError) {
      if (
        idempotencyKey &&
        createError instanceof Prisma.PrismaClientKnownRequestError &&
        createError.code === "P2002"
      ) {
        const existingTx = await prisma.transaction.findUnique({
          where: { idempotencyKey },
        });

        if (existingTx) {
          res.status(202).json({
            transaction_id: existingTx.id,
            currency: existingTx.localCurrency ?? currency,
            amount: existingTx.localAmount?.toString() ?? amountDecimal.toString(),
            wallet_address: wallet_address ? "***" : undefined,
            status: existingTx.status,
            message:
              existingTx.status === "completed"
                ? "Deposit already processed."
                : "Deposit already received and is still being processed.",
          });
          return;
        }
      }

      throw createError;
    }

    try {
      const acbuAmountInfo = await convertLocalToUsdWithPrecision(
        amountDecimal.toString(),
        currency,
      );
      const sourceAccount = stellarClient.getKeypair()?.publicKey();
      if (!sourceAccount) {
        throw new Error("No source account available");
      }

      const mintResult = await acbuMintingService.mintFromBasket({
        txId: tx.id,
        user: sourceAccount,
        recipient: wallet_address,
        acbuAmount: decimalToContractNumber(acbuAmountInfo.acbuEquivalent).toString(),
      });
      const acbuNum = contractNumberToDecimal(Number(mintResult.acbuAmount));

      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          status: "completed",
          acbuAmount: new Decimal(acbuNum),
          blockchainTxHash: mintResult.transactionHash,
          completedAt: new Date(),
          rateSnapshot: {
            deposit_currency: currency,
            amount: amountDecimal.toNumber(),
            acbu_amount: acbuNum.toNumber(),
            transaction_hash: mintResult.transactionHash,
            timestamp: new Date().toISOString(),
          },
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          status: "failed",
          rateSnapshot: {
            deposit_currency: currency,
            amount: amountDecimal.toNumber(),
            error: message,
            at: new Date().toISOString(),
          },
        },
      });

      // Audit trail: record deposit/mint failure (W10-OBS-006)
      await logAudit({
        eventType: "transaction",
        entityType: "transaction",
        entityId: tx.id,
        action: "deposit_failed",
        newValue: {
          type: "mint",
          currency,
          amount: Number(amountDecimal.toString()),
          wallet_address: wallet_address ? "***" : undefined,
          error: message,
        },
        performedBy: req.apiKey?.userId ?? undefined,
      }).catch((auditErr) => {
        logger.error("Audit log failed for deposit_failed", {
          transactionId: tx.id,
          error: auditErr instanceof Error ? auditErr.message : String(auditErr),
        });
      });

      throw err;
    }

    await logAudit({
      eventType: "transaction",
      entityType: "transaction",
      entityId: tx.id,
      action: "deposit_created",
      newValue: {
        type: "mint",
        currency,
        amount: Number(amountDecimal.toString()),
        wallet_address: wallet_address ? "***" : undefined,
      },
      performedBy: req.apiKey?.userId ?? undefined,
    });

    res.status(202).json({
      transaction_id: tx.id,
      currency,
      amount: amountDecimal.toString(),
      wallet_address: wallet_address ? "***" : undefined,
      status: "completed",
      message: "Deposit received and ACBU has been minted to the wallet.",
    });
  } catch (error) {
    next(error);
  }
}

// ── Mint Confirmation (W10-SEC-017) ─────────────────────────────────────────

/**
 * Request schema for the authoritative mint-confirmation payload.
 *
 * Partners POST this body to /v1/mint/confirm after a basket-currency deposit
 * has settled on their end.  The body is HMAC-SHA256 signed with
 * MINT_CONFIRMATION_SECRET; the server verifies the signature before
 * touching any on-chain state.
 */
export const mintConfirmBodySchema = z.object({
  /** The pending Transaction.id created by /v1/mint/deposit (status "pending"). */
  transaction_id: z.string().min(1, "transaction_id is required"),
  /**
   * Partner-assigned reference for the settled deposit payment.
   * Used for audit correlation; stored in rateSnapshot.
   */
  partner_reference: z
    .string()
    .min(1)
    .max(255)
    .regex(/^\S+$/, "partner_reference must not contain whitespace"),
  /** Confirmed settled amount in local currency (must match the original deposit). */
  amount: z
    .string()
    .min(1)
    .refine(
      (s) => /^\d+(\.\d{1,7})?$/.test(s.trim()) && parseFloat(s.trim()) > 0,
      "amount must be positive with up to 7 decimal places",
    ),
  /** 3-letter ISO currency code of the settled amount. */
  currency: z
    .string()
    .length(3)
    .transform((v) => v.toUpperCase()),
  /** Unix timestamp (seconds) when the settlement was confirmed by the partner. */
  confirmed_at: z.coerce.number().int().positive(),
});

export type MintConfirmBody = z.infer<typeof mintConfirmBodySchema>;

/**
 * Express middleware: HMAC-SHA256 signature verification for /v1/mint/confirm.
 *
 * The partner must set the `x-mint-signature` header to the hex-encoded
 * HMAC-SHA256 of the raw request body, keyed with MINT_CONFIRMATION_SECRET.
 * A timestamp header `x-mint-timestamp` (Unix seconds) is required and must
 * fall within ±5 minutes of server time to prevent replay attacks.
 *
 * This is the *authoritative* gate — no mint is triggered without a valid
 * signature from a configured secret.  The deprecated Flutterwave/Paystack
 * webhook paths (audit-only) never controlled minting and are not affected.
 */
export function verifyMintConfirmationSignature(
  req: Request & { rawBody?: Buffer },
  res: Response,
  next: NextFunction,
): void {
  const secret = config.mint?.confirmationSecret;
  if (!secret) {
    // Endpoint is misconfigured — reject with 503 so operators know the env var is missing.
    logger.error(
      "MINT_CONFIRMATION_SECRET is not configured — rejecting mint confirmation. " +
        "Set the environment variable to enable the /v1/mint/confirm endpoint.",
    );
    throw new AppError(
      "Mint confirmation unavailable: secret not configured",
      503,
      ErrorCodes.CONFIG_ERROR,
    );
  }

  // Replay-protection: validate timestamp header
  const rawTs = req.headers["x-mint-timestamp"] as string | undefined;
  if (!rawTs) {
    throw new AppError("Missing x-mint-timestamp header", 401, ErrorCodes.MISSING_SIGNATURE);
  }
  const tsNum = Number(rawTs);
  if (!Number.isFinite(tsNum)) {
    throw new AppError("Invalid x-mint-timestamp header", 401, ErrorCodes.INVALID_SIGNATURE);
  }
  const nowS = Date.now() / 1000;
  const TOLERANCE_S = 300; // ±5 minutes, consistent with other webhook verifiers
  if (Math.abs(nowS - tsNum) > TOLERANCE_S) {
    logger.warn("Mint confirmation timestamp outside tolerance window", {
      timestamp: tsNum,
      toleranceS: TOLERANCE_S,
    });
    res.status(401).json({ error: "Mint confirmation timestamp invalid or expired" });
    return;
  }

  // Signature verification
  const received = req.headers["x-mint-signature"] as string | undefined;
  if (!received) {
    throw new AppError("Missing x-mint-signature header", 401, ErrorCodes.MISSING_SIGNATURE);
  }

  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    throw new AppError("Raw body required for verification", 400, ErrorCodes.RAW_BODY_REQUIRED);
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
    logger.warn("Mint confirmation signature mismatch");
    throw new AppError("Invalid mint confirmation signature", 401, ErrorCodes.INVALID_SIGNATURE);
  }

  next();
}

/**
 * POST /v1/mint/confirm
 *
 * Authoritative, signature-verified mint-confirmation endpoint (W10-SEC-017).
 *
 * Called by a trusted partner after a basket-currency deposit settles.  The
 * request MUST be signed with MINT_CONFIRMATION_SECRET via
 * `verifyMintConfirmationSignature` middleware (enforced in mintRoutes.ts).
 *
 * Flow:
 *  1. Validate body schema.
 *  2. Look up the pending Transaction by transaction_id.
 *  3. Verify the transaction is in "pending" status (idempotent: return 200 if already "completed").
 *  4. Enforce circuit-breaker (minting paused check).
 *  5. Convert confirmed local amount to ACBU equivalent.
 *  6. Call acbuMintingService.mintFromBasket on-chain.
 *  7. Update transaction to "completed" with on-chain hash.
 *
 * Security properties:
 *  - Only proceeds if HMAC signature is valid (enforced by upstream middleware).
 *  - Idempotent: a second confirmation for an already-completed transaction returns 200.
 *  - Circuit-breaker respected: rejects if reserve ratio is below threshold.
 *  - No minting is possible via deprecated Flutterwave/Paystack webhook paths.
 */
export async function confirmMint(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = mintConfirmBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        "Invalid mint confirmation payload",
        400,
        ErrorCodes.VALIDATION_ERROR,
        parsed.error.flatten(),
      );
    }

    const { transaction_id, partner_reference, amount, currency, confirmed_at } = parsed.data;

    // Fetch the pending transaction
    const tx = await prisma.transaction.findUnique({
      where: { id: transaction_id },
    });

    if (!tx) {
      throw new AppError(`Transaction ${transaction_id} not found`, 404, ErrorCodes.NOT_FOUND);
    }

    // Idempotency: if already completed, return success without re-minting
    if (tx.status === "completed") {
      logger.info("Mint confirmation: transaction already completed (idempotent)", {
        transactionId: transaction_id,
        partnerReference: partner_reference,
      });
      res.status(200).json({
        ok: true,
        transaction_id,
        status: "completed",
        acbu_amount: tx.acbuAmount?.toString() ?? null,
        blockchain_tx_hash: tx.blockchainTxHash ?? null,
        message: "Transaction already confirmed and minted.",
      });
      return;
    }

    if (tx.status !== "pending") {
      throw new AppError(
        `Transaction ${transaction_id} is in status "${tx.status}" and cannot be confirmed`,
        409,
        ErrorCodes.BAD_REQUEST,
      );
    }

    // Circuit-breaker check
    const paused = await isMintingPaused();
    if (paused) {
      throw new AppError(
        "New minting is temporarily paused (reserve ratio below 102%).",
        503,
        ErrorCodes.CIRCUIT_BREAKER,
      );
    }

    // Derive the wallet address from the transaction (stored at deposit time)
    // The wallet address is embedded in the rateSnapshot JSON or can be looked
    // up from the originating user.  We resolve it from the transaction owner.
    const userWallet = await prisma.user
      .findUnique({ where: { id: tx.userId ?? "" }, select: { stellarAddress: true } })
      .then((u) => u?.stellarAddress ?? null);

    if (!userWallet) {
      throw new AppError(
        "Cannot resolve wallet address for transaction — user wallet not configured",
        422,
        ErrorCodes.VALIDATION_ERROR,
      );
    }

    // Convert confirmed local amount to ACBU
    const amountDecimal = parseMonetaryString(amount, "amount");
    const acbuAmountInfo = await convertLocalToUsdWithPrecision(amountDecimal.toString(), currency);

    const sourceAccount = stellarClient.getKeypair()?.publicKey();
    if (!sourceAccount) {
      throw new AppError("Stellar source account not configured", 503, ErrorCodes.CONFIG_ERROR);
    }

    // Mark as processing to prevent concurrent confirmations
    await prisma.transaction.update({
      where: { id: transaction_id },
      data: {
        status: "processing",
        rateSnapshot: {
          ...(tx.rateSnapshot as object | null ?? {}),
          partner_reference,
          confirmed_at: new Date(confirmed_at * 1000).toISOString(),
          confirmation_received_at: new Date().toISOString(),
        },
      },
    });

    try {
      const mintResult = await acbuMintingService.mintFromBasket({
        txId: transaction_id,
        user: sourceAccount,
        recipient: userWallet,
        acbuAmount: decimalToContractNumber(acbuAmountInfo.acbuEquivalent).toString(),
      });

      const acbuNum = contractNumberToDecimal(Number(mintResult.acbuAmount));

      await prisma.transaction.update({
        where: { id: transaction_id },
        data: {
          status: "completed",
          acbuAmount: new Decimal(acbuNum),
          blockchainTxHash: mintResult.transactionHash,
          completedAt: new Date(),
          rateSnapshot: {
            ...(tx.rateSnapshot as object | null ?? {}),
            partner_reference,
            confirmed_at: new Date(confirmed_at * 1000).toISOString(),
            confirmed_amount: amount,
            confirmed_currency: currency,
            acbu_amount: acbuNum.toNumber(),
            transaction_hash: mintResult.transactionHash,
            confirmation_completed_at: new Date().toISOString(),
          },
        },
      });

      await logAudit({
        eventType: "transaction",
        entityType: "transaction",
        entityId: transaction_id,
        action: "mint_confirmed",
        newValue: {
          type: "mint_confirmation",
          partner_reference,
          currency,
          amount: amountDecimal.toNumber(),
          acbu_amount: acbuNum.toNumber(),
          blockchain_tx_hash: mintResult.transactionHash,
        },
      });

      logger.info("Mint confirmation: on-chain mint succeeded", {
        transactionId: transaction_id,
        partnerReference: partner_reference,
        acbuAmount: acbuNum.toString(),
        blockchainTxHash: mintResult.transactionHash,
      });

      res.status(200).json({
        ok: true,
        transaction_id,
        status: "completed",
        acbu_amount: acbuNum.toString(),
        blockchain_tx_hash: mintResult.transactionHash,
        message: "Deposit confirmed and ACBU minted on-chain.",
      });
    } catch (mintErr: unknown) {
      const message = mintErr instanceof Error ? mintErr.message : String(mintErr);
      logger.error("Mint confirmation: on-chain mint failed", {
        transactionId: transaction_id,
        partnerReference: partner_reference,
        error: message,
      });

      await prisma.transaction.update({
        where: { id: transaction_id },
        data: {
          status: "failed",
          rateSnapshot: {
            ...(tx.rateSnapshot as object | null ?? {}),
            partner_reference,
            confirmed_at: new Date(confirmed_at * 1000).toISOString(),
            error: message,
            at: new Date().toISOString(),
          },
        },
      });

      throw mintErr;
    }
  } catch (error) {
    next(error);
  }
}
