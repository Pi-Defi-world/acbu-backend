/**
 * USDC on-ramp: register that user swapped USDC→XLM on Stellar LP.
 * Creates OnRampSwap and enqueues XLM→ACBU job to mint ACBU to user.
 */
import { Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
import { AuthRequest } from "../middleware/auth";
import { Decimal } from "@prisma/client/runtime/library";
import { enqueueXlmToAcbu } from "../jobs/xlmToAcbuJob";
import { AppError } from "../middleware/errorHandler";
import { isValidStellarAddress } from "../utils/stellar";

async function assertUserWalletAddress(
  userId: string,
  providedAddress: string,
): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stellarAddress: true },
  });

  if (!user?.stellarAddress) {
    throw new AppError("User wallet address not set", 400);
  }

  if (user.stellarAddress !== providedAddress) {
    throw new AppError("Wallet address does not match user", 403);
  }

  return user.stellarAddress;
}

const bodySchema = z.object({
  stellar_address: z
    .string()
    .length(56)
    .regex(/^G/)
    .refine(
      (s) => isValidStellarAddress(s),
      "Invalid Stellar address (bad checksum)",
    ),
  xlm_amount: z
    .string()
    .min(1)
    .refine(
      (s) => !Number.isNaN(Number(s)) && Number(s) > 0,
      "must be positive",
    ),
  usdc_amount: z
    .string()
    .min(1)
    .refine(
      (s) => !Number.isNaN(Number(s)) && Number(s) >= 0,
      "must be non-negative",
    )
    .optional(),
});

/**
 * POST /v1/onramp/register - Register USDC→XLM swap; job will sell XLM and mint ACBU to user.
 */
export async function registerOnRampSwap(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) {
      throw new AppError("User context required for on-ramp registration", 401);
    }
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("Invalid request", 400, "VALIDATION_ERROR", parsed.error.flatten());
    }

    const { stellar_address, xlm_amount, usdc_amount } = parsed.data;
    const userWalletAddress = await assertUserWalletAddress(
      userId,
      stellar_address,
    );
    const xlmNum = Number(xlm_amount);
    const swap = await prisma.onRampSwap.create({
      data: {
        userId,
        stellarAddress: userWalletAddress,
        source: "xlm_deposit",
        xlmAmount: new Decimal(xlmNum),
        usdcAmount:
          usdc_amount != null ? new Decimal(Number(usdc_amount)) : null,
        status: "pending_convert",
      },
    });
    await enqueueXlmToAcbu({
      onRampSwapId: swap.id,
      userId,
      stellarAddress: userWalletAddress,
      xlmAmount: xlm_amount,
      usdcEquivalent: usdc_amount,
    });
    res.status(202).json({
      on_ramp_swap_id: swap.id,
      status: "pending_convert",
      message:
        "XLM→ACBU job queued. ACBU will be minted to your wallet when processing completes.",
    });
  } catch (error) {
    next(error);
  }
}
