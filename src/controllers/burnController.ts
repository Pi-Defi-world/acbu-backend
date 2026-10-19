/*
 * POST /v1/burn/acbu - Burn ACBU for local currency redemption.
 * Creates transaction record; invokes burning contract when configured.
 */
import { Response, NextFunction } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma as _prisma } from "../config/database";

// Cast to PrismaClient to resolve the Accelerate union-type TS2349 error (#717).
// The runtime value is always a PrismaClient (possibly extended with Accelerate),
// and all method signatures are compatible; the cast is safe.
const prisma = _prisma as unknown as PrismaClient;
import { getContractAddresses } from "../config/contracts";
import { acbuBurningService } from "../services/contracts";
import { stellarClient } from "../services/stellar/client";
import { AuthRequest } from "../middleware/auth";
import { Decimal } from "@prisma/client/runtime/library";
import { logAudit } from "../services/audit";
import {
  checkWithdrawalLimits,
  isCurrencyWithdrawalPaused,
} from "../services/limits/limitsService";
import { getBurnFeeBps } from "../services/feePolicy/feePolicyService";
import {
  parseMonetaryString,
  decimalToContractNumber,
  contractNumberToDecimal,
  calculateFee,
} from "../utils/decimalUtils";
import { AppError } from "../middleware/errorHandler";
import { getLatestAcbuRate } from "../services/rates/acbuRateCache";
import { logger } from "../config/logger";

function extractIdempotencyKey(req: AuthRequest): string | undefined {
  const key = req.headers["idempotency-key"];
  if (Array.isArray(key)) return key[0];
  return typeof key === "string" ? key : undefined;
}

const burnBodySchema = z.object({
  acbu_amount: z.string().min(1),
  currency: z.enum(["NGN", "KES", "RWF"]),
});

type BurnRequest = z.infer<typeof burnBodySchema>;

/**
 * Burn ACBU for local currency redemption
 * - Validates wallet has sufficient balance
 * - Checks withdrawal limits and currency pause status
 * - Creates burn transaction record
 * - Invokes contract burning if configured
 */
export const burnAcbu = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // Validate API key is present and user is authenticated
    if (!req.apiKey?.userId) {
      throw new AppError("Authentication required", 401);
    }

    const idempotencyKey = extractIdempotencyKey(req);
    if (!idempotencyKey) {
      throw new AppError("Idempotency-Key header is required", 400);
    }

    // Parse and validate request body
    const parsed = burnBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("Invalid request body", 400);
    }
    const body: BurnRequest = parsed.data;

    // Check if currency withdrawal is paused
    if (await isCurrencyWithdrawalPaused(body.currency)) {
      throw new AppError(`Withdrawals for ${body.currency} are temporarily paused`, 503);
    }

    // Parse ACBU amount
    const acbuAmount = parseMonetaryString(body.acbu_amount);
    if (acbuAmount.isNaN() || acbuAmount.isNegative()) {
      throw new AppError("Invalid ACBU amount", 400);
    }

    // Load user's wallet
    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.apiKey.userId },
      select: {
        id: true,
        acbuBalance: true,
        userId: true,
      },
    });

    if (!wallet) {
      throw new AppError("Wallet not found", 404);
    }

    // **SECURITY FIX (AB-009)**: Verify sufficient balance before attempting burn
    const currentBalance = new Decimal(wallet.acbuBalance as any);
    if (currentBalance.lt(acbuAmount)) {
      logger.warn("Burn rejected: insufficient balance", {
        userId: req.apiKey.userId,
        requested: acbuAmount.toString(),
        available: currentBalance.toString(),
      });
      throw new AppError(
        `Insufficient ACBU balance. Available: ${currentBalance.toString()}, Requested: ${acbuAmount.toString()}`,
        400,
      );
    }

    // Get burn fee and calculate total deduction
    const feeBps = await getBurnFeeBps();
    const fee = calculateFee(acbuAmount, feeBps);
    const totalDeduction = acbuAmount.plus(fee);

    // Final balance check with fees
    if (currentBalance.lt(totalDeduction)) {
      logger.warn("Burn rejected: insufficient balance for burn + fee", {
        userId: req.apiKey.userId,
        acbuAmount: acbuAmount.toString(),
        fee: fee.toString(),
        total: totalDeduction.toString(),
        available: currentBalance.toString(),
      });
      throw new AppError(
        `Insufficient balance for burn and fees. Required: ${totalDeduction.toString()}, Available: ${currentBalance.toString()}`,
        400,
      );
    }

    // Check withdrawal limits
    await checkWithdrawalLimits(req.apiKey.userId, acbuAmount);

    // Check for idempotency
    const existingBurn = await prisma.burnTransaction.findUnique({
      where: { idempotencyKey },
    });

    if (existingBurn) {
      res.status(200).json({
        transaction_id: existingBurn.id,
        status: existingBurn.status,
        amount: existingBurn.acbuAmount,
        fee: existingBurn.feeAmount,
      });
      return;
    }

    // Create burn transaction record
    const burnTx = await prisma.burnTransaction.create({
      data: {
        userId: req.apiKey.userId,
        acbuAmount: acbuAmount,
        feeAmount: fee,
        currency: body.currency,
        idempotencyKey,
        status: "PENDING",
      },
    });

    // Attempt to invoke contract if configured
    const contractAddresses = getContractAddresses();
    let transactionHash: string | null = null;

    if (contractAddresses.burning) {
      try {
        const result = await acbuBurningService.redeemSingle({
          user: req.apiKey.userId,
          recipient: wallet.id,
          acbuAmount: decimalToContractNumber(acbuAmount),
          currency: body.currency,
          idempotencyKey,
        });

        transactionHash = result.transactionHash;

        // Update burn transaction with contract result
        await prisma.burnTransaction.update({
          where: { id: burnTx.id },
          data: {
            status: "CONFIRMED",
            contractTxHash: transactionHash,
            completedAt: new Date(),
          },
        });

        // Deduct from wallet balance
        await prisma.wallet.update({
          where: { id: wallet.id },
          data: {
            acbuBalance: {
              decrement: totalDeduction,
            },
          },
        });

        await logAudit("BURN_SUCCESS", {
          userId: req.apiKey.userId,
          acbuAmount: acbuAmount.toString(),
          currency: body.currency,
          txHash: transactionHash,
        });

        res.status(200).json({
          transaction_id: burnTx.id,
          status: "CONFIRMED",
          amount: acbuAmount,
          fee,
          transaction_hash: transactionHash,
        });
      } catch (contractError) {
        logger.error("Contract invocation failed", { burnTxId: burnTx.id, contractError });

        // Update burn transaction to reflect contract failure
        await prisma.burnTransaction.update({
          where: { id: burnTx.id },
          data: { status: "FAILED" },
        });

        await logAudit("BURN_FAILED", {
          userId: req.apiKey.userId,
          acbuAmount: acbuAmount.toString(),
          reason: contractError instanceof Error ? contractError.message : "Unknown error",
        });

        throw new AppError("Contract invocation failed. Please try again later.", 500);
      }
    } else {
      // No contract configured - mark as pending and awaiting async processing
      res.status(202).json({
        transaction_id: burnTx.id,
        status: "PENDING",
        amount: acbuAmount,
        fee,
        message: "Burn transaction submitted and is being processed",
      });
    }
  } catch (error) {
    next(error);
  }
};
