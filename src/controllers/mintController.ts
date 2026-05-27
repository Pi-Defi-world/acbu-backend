/**
 * Mint/deposit controllers.
 * Deposit rule: only basket (pool) currencies for /mint/deposit. USDC and XLM deposits accepted via /mint/usdc and /onramp/register; we run conversion and LP/swap in backend; mint proceeds once USDC→XLM conversion succeeds.
 */
import { Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
import { getContractAddresses } from "../config/contracts";
import { acbuMintingService } from "../services/contracts";
import { stellarClient } from "../services/stellar/client";
import { AuthRequest } from "../middleware/auth";
import { Decimal } from "@prisma/client/runtime/library";
import { logAudit } from "../services/audit";
import {
  BASKET_CURRENCIES,
  isAllowedDepositCurrency,
  isForbiddenDepositCurrency,
} from "../config/basket";
import {
  checkDepositLimits,
  isMintingPaused,
} from "../services/limits/limitsService";
import { enqueueUsdcConvertAndMint } from "../jobs/usdcConvertAndMintJob";
import { AppError } from "../middleware/errorHandler";
import { assertUserWalletAddress } from "../services/wallet/walletService";
import {
  parseMonetaryString,
  decimalToContractNumber,
  contractNumberToDecimal,
  calculateFee,
} from "../utils/decimalUtils";
import { logFinancialEvent } from "../config/logger";

const MINT_FEE_BPS = 30; // 0.3%
// DECIMALS_7 is kept for reference but replaced by decimalToContractNumber
const DECIMALS_7 = 1e7;

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
    const parsed = usdcBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("Invalid request", 400, "VALIDATION_ERROR", parsed.error.flatten());
    }

    const { usdc_amount, wallet_address } = parsed.data;
    const userWalletAddress = await assertUserWalletAddress(
      userId,
      wallet_address,
    );
    const usdcDecimal = parseMonetaryString(usdc_amount, "usdc_amount");
    const usdcNum = usdcDecimal.toNumber(); // Only convert at boundary for limits service
    // SECURITY: Always enforce circuit breaker and deposit limits
    // Previously these checks were skipped when req.audience was undefined,
    // allowing bypass of critical financial controls via direct /mint/usdc route
    const paused = await isMintingPaused();
    if (paused) {
      throw new AppError(
        "New minting is temporarily paused (reserve ratio below 102%).",
        503,
        "CIRCUIT_BREAKER",
      );
    }


    // Apply deposit limits - use retail as default if no audience is set
    // FIX #32: Defaulting to "retail" prevents limit bypass when audience is undefined
    const audience = req.audience || "retail";
    await checkDepositLimits(
      audience,
      usdcNum,
      userId,
      req.apiKey?.organizationId ?? null,
    );
    const swap = await prisma.onRampSwap.create({
      data: {
        userId,
        stellarAddress: userWalletAddress,
        source: "usdc_deposit",
        usdcAmount: new Decimal(usdcDecimal),
        xlmAmount: null,
        status: "pending_convert",
      },
    });
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
): Promise<{ transactionId: string; acbuAmount: number }> {
<<<<<<< HEAD
  const usdcDecimal = new Decimal(usdcAmount);
  const feeUsdcDecimal = calculateFee(usdcDecimal, MINT_FEE_BPS);
  const usdcAmount7 = decimalToContractNumber(usdcDecimal).toString();
  const correlationId = crypto.randomUUID();
=======
  const feeUsdc = (usdcAmount * MINT_FEE_BPS) / 10000;
  const usdcAmount7 = Math.round(usdcAmount * DECIMALS_7).toString();
  const correlationId = crypto.randomUUID();
>>>>>>> upstream/main
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

  logFinancialEvent({
    event: "mint.initiated",
    status: "pending",
    transactionId: tx.id,
    userId: userId ?? tx.id,
    accountId: walletAddress,
    idempotencyKey: tx.id,
    amount: Math.round(usdcAmount * 100), // cents
    currency: "USDC",
    correlationId,
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
    const acbuNum = acbuDecimal.toNumber();
    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        status: "completed",
        acbuAmount: new Decimal(acbuDecimal),
        blockchainTxHash: result.transactionHash,
        completedAt: new Date(),
      },
    });
    logFinancialEvent({
      event: "mint.completed",
      status: "success",
      transactionId: tx.id,
      userId: userId ?? tx.id,
      accountId: walletAddress,
      idempotencyKey: tx.id,
      amount: Math.round(usdcAmount * 100),
      currency: "USDC",
      correlationId,
      providerRef: result.transactionHash,
    });
    return { transactionId: tx.id, acbuAmount: acbuNum };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Soroban mint_from_usdc failed:", message);
    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        status: "failed",
        rateSnapshot: { error: message, at: new Date().toISOString() },
      },
    });
    logFinancialEvent({
      event: "mint.failed",
      status: "failed",
      transactionId: tx.id,
      userId: userId ?? tx.id,
      accountId: walletAddress,
      idempotencyKey: tx.id,
      amount: Math.round(usdcAmount * 100),
      currency: "USDC",
      correlationId,
      errorMessage: message,
    });
    throw err;
  }
}

export const depositBodySchema = z.object({
  currency: z.string().length(3).toUpperCase(),
  amount: z
    .string()
    .min(1)
    .refine(
      (s) => /^\d+(\.\d{1,7})?$/.test(s.trim()) && parseFloat(s.trim()) > 0,
      "must be positive with up to 7 decimal places",
    ),
  wallet_address: z.string().length(56).regex(/^G/),
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
      res
        .status(400)
        .json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    const { currency, amount, wallet_address } = parsed.data;
    if (isForbiddenDepositCurrency(currency)) {
      throw new AppError(
        `Deposits in ${currency} are not allowed. Only basket (pool) currencies are accepted: ${BASKET_CURRENCIES.join(", ")}. For USDC, use the on-ramp (swap USDC→XLM via Stellar LP).`,
        400,
        "DEPOSIT_ONLY_BASKET_CURRENCIES",
        { deposit_currencies_allowed: [...BASKET_CURRENCIES] },
      );
    }
    if (!isAllowedDepositCurrency(currency)) {
      throw new AppError(
        `Currency ${currency} is not in the basket. Allowed: ${BASKET_CURRENCIES.join(", ")}.`,
        400,
        "INVALID_CURRENCY",
        { deposit_currencies_allowed: [...BASKET_CURRENCIES] },
      );
    }
    const amountDecimal = parseMonetaryString(amount, "amount");
    const amountNum = amountDecimal.toNumber(); // Only convert at boundary for existing code
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
        "CIRCUIT_BREAKER",
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
      amountUsdPlaceholder,
      userId,
      req.apiKey?.organizationId ?? null,
    );
    const tx = await prisma.transaction.create({
      data: {
        userId: req.apiKey?.userId ?? undefined,
        organizationId: req.apiKey?.organizationId ?? undefined,
        type: "mint",
        status: "pending",
        localCurrency: currency,
        localAmount: new Decimal(amountDecimal),
        rateSnapshot: {
          deposit_currency: currency,
          amount: amountDecimal.toNumber(),
          timestamp: new Date().toISOString(),
        },
      },
    });
    await logAudit({
      eventType: "transaction",
      entityType: "transaction",
      entityId: tx.id,
      action: "deposit_created",
      newValue: {
        type: "mint",
        currency,
        amount: amountDecimal.toNumber(),
        wallet_address: wallet_address ? "***" : undefined,
      },
      performedBy: req.apiKey?.userId ?? undefined,
    });
    res.status(202).json({
      transaction_id: tx.id,
      currency,
      amount: amountDecimal.toString(),
      wallet_address: wallet_address ? "***" : undefined,
      status: "pending",
      message:
        "Deposit received. Complete payment to the designated account for your currency; ACBU will be minted after confirmation.",
    });
  } catch (error) {
    next(error);
  }
}
