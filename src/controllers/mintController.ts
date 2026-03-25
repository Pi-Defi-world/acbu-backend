/**
 * Mint/deposit controllers.
 * Deposit rule: only basket (pool) currencies for /mint/deposit. USDC and XLM deposits accepted via /mint/usdc and /onramp/register; we run conversion and LP/swap in backend; mint proceeds once USDC→XLM conversion succeeds.
 */
import { Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
import { getContractAddresses } from "../config/contracts";
import { acbuMintingService } from "../services/contracts";
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

const MINT_FEE_BPS = 30; // 0.3%
const DECIMALS_7 = 1e7;

const usdcBodySchema = z.object({
  usdc_amount: z
    .string()
    .min(1)
    .refine(
      (s) => !Number.isNaN(Number(s)) && Number(s) > 0,
      "must be positive",
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
      res
        .status(400)
        .json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    const { usdc_amount, wallet_address } = parsed.data;
    const usdcNum = Number(usdc_amount);
    // SECURITY: Always enforce circuit breaker and deposit limits
    // Previously these checks were skipped when req.audience was undefined,
    // allowing bypass of critical financial controls via direct /mint/usdc route
    const paused = await isMintingPaused();
    if (paused) {
      res.status(503).json({
        error: "Minting paused",
        code: "CIRCUIT_BREAKER",
        message:
          "New minting is temporarily paused (reserve ratio below 102%).",
      });
      return;
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
        stellarAddress: wallet_address,
        source: "usdc_deposit",
        usdcAmount: new Decimal(usdcNum),
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
): Promise<{ transactionId: string; acbuAmount: number }> {
  const feeUsdc = (usdcAmount * MINT_FEE_BPS) / 10000;
  const usdcAmount7 = Math.round(usdcAmount * DECIMALS_7).toString();
  const tx = await prisma.transaction.create({
    data: {
      userId: userId ?? undefined,
      type: "mint",
      status: "pending",
      usdcAmount: new Decimal(usdcAmount),
      fee: new Decimal(feeUsdc),
      rateSnapshot: {
        source: "xlm_on_ramp",
        timestamp: new Date().toISOString(),
      },
    },
  });
  const addresses = getContractAddresses();
  if (addresses.minting) {
    const result = await acbuMintingService.mintFromUsdc({
      usdcAmount: usdcAmount7,
      recipient: walletAddress,
    });
    const acbuNum = Number(result.acbuAmount) / DECIMALS_7;
    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        status: "completed",
        acbuAmount: new Decimal(acbuNum),
        blockchainTxHash: result.transactionHash,
        completedAt: new Date(),
      },
    });
    return { transactionId: tx.id, acbuAmount: acbuNum };
  }
  return { transactionId: tx.id, acbuAmount: 0 };
}

const depositBodySchema = z.object({
  currency: z.string().length(3).toUpperCase(),
  amount: z
    .string()
    .min(1)
    .refine(
      (s) => !Number.isNaN(Number(s)) && Number(s) > 0,
      "must be positive",
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
      res.status(400).json({
        error: "Currency not allowed for deposit",
        code: "DEPOSIT_ONLY_BASKET_CURRENCIES",
        message: `Deposits in ${currency} are not allowed. Only basket (pool) currencies are accepted: ${BASKET_CURRENCIES.join(", ")}. For USDC, use the on-ramp (swap USDC→XLM via Stellar LP).`,
        deposit_currencies_allowed: [...BASKET_CURRENCIES],
      });
      return;
    }
    if (!isAllowedDepositCurrency(currency)) {
      res.status(400).json({
        error: "Invalid currency",
        message: `Currency ${currency} is not in the basket. Allowed: ${BASKET_CURRENCIES.join(", ")}.`,
        deposit_currencies_allowed: [...BASKET_CURRENCIES],
      });
      return;
    }
    const amountNum = Number(amount);
    // SECURITY: Always enforce circuit breaker and deposit limits
    // Previously these checks were skipped when req.audience was undefined,
    // allowing bypass of critical financial controls via direct /mint/deposit route
    const paused = await isMintingPaused();
    if (paused) {
      res.status(503).json({
        error: "Minting paused",
        code: "CIRCUIT_BREAKER",
        message:
          "New minting is temporarily paused (reserve ratio below 102%).",
      });
      return;
    }

    // Apply deposit limits - use retail as default if no audience is set
    const audience = req.audience || "retail";
    const amountUsdPlaceholder = amountNum; // TODO: convert via rate to USD for accurate limit
    await checkDepositLimits(
      audience,
      amountUsdPlaceholder,
      req.apiKey?.userId ?? null,
      req.apiKey?.organizationId ?? null,
    );
    const tx = await prisma.transaction.create({
      data: {
        userId: req.apiKey?.userId ?? undefined,
        type: "mint",
        status: "pending",
        localCurrency: currency,
        localAmount: new Decimal(amountNum),
        rateSnapshot: {
          deposit_currency: currency,
          amount: amountNum,
          organizationId: req.apiKey?.organizationId ?? null,
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
        amount: amountNum,
        wallet_address: wallet_address ? "***" : undefined,
      },
      performedBy: req.apiKey?.userId ?? undefined,
    });
    res.status(202).json({
      transaction_id: tx.id,
      currency,
      amount: String(amountNum),
      wallet_address: wallet_address ? "***" : undefined,
      status: "pending",
      message:
        "Deposit received. Complete payment to the designated account for your currency; ACBU will be minted after confirmation.",
    });
  } catch (error) {
    next(error);
  }
}
