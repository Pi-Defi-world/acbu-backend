/**
 * POST /v1/burn/acbu - Burn ACBU for local currency redemption.
 * Creates transaction record; invokes burning contract when configured.
 */
import { Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
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

const DECIMALS_7 = 1e7;

const recipientAccountSchema = z.object({
  type: z.enum(["bank", "mobile_money"]).optional(),
  account_number: z.string().min(1),
  bank_code: z.string().min(1),
  account_name: z.string().min(1),
});

const bodySchema = z.object({
  acbu_amount: z
    .string()
    .min(1)
    .refine(
      (s) => !Number.isNaN(Number(s)) && Number(s) > 0,
      "must be positive",
    ),
  currency: z.string().length(3).toUpperCase(),
  recipient_account: recipientAccountSchema,
  blockchain_tx_hash: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/, "blockchain_tx_hash must be a 64-char hex hash")
    .optional(),
});

export async function burnAcbu(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("Invalid request", 400, "VALIDATION_ERROR", parsed.error.flatten());
    }
    const { acbu_amount, currency, recipient_account, blockchain_tx_hash } =
      parsed.data;
    const acbuNum = Number(acbu_amount);
    const burnFeeBps = await getBurnFeeBps(currency);
    const feeAcbu = (acbuNum * burnFeeBps) / 10000;
    const acbuAmount7 = Math.round(acbuNum * DECIMALS_7).toString();

    const acbuRateRecord = await prisma.acbuRate.findFirst({
      orderBy: { timestamp: "desc" },
    });
    if (!acbuRateRecord) {
      throw new Error("ACBU rates not available");
    }
    const rateKey =
      `acbu${currency.charAt(0).toUpperCase() + currency.slice(1).toLowerCase()}` as keyof typeof acbuRateRecord;
    const acbuPerLocal = acbuRateRecord[rateKey];
    if (
      !acbuPerLocal ||
      typeof acbuPerLocal !== "object" ||
      !("toNumber" in acbuPerLocal)
    ) {
      throw new Error(`Rate not found for currency ${currency}`);
    }
    const localNum = acbuNum * acbuPerLocal.toNumber();

    // SECURITY: Always enforce circuit breaker and withdrawal limits
    // Previously these checks were skipped when req.audience was undefined,
    // allowing bypass of critical financial controls via direct /burn/acbu route
    const paused = await isCurrencyWithdrawalPaused(currency);
    if (paused) {
      throw new AppError(
        `Single-currency withdrawals for ${currency} are temporarily paused (reserve below threshold). Basket withdrawals continue.`,
        503,
        "CIRCUIT_BREAKER",
      );
    }

    // Apply withdrawal limits - use retail as default if no audience is set
    const audience = req.audience || "retail";
    await checkWithdrawalLimits(
      audience,
      acbuNum,
      currency,
      req.apiKey?.userId ?? null,
      req.apiKey?.organizationId ?? null,
    );

    const tx = await prisma.transaction.create({
      data: {
        userId: req.apiKey?.userId ?? undefined,
        type: "burn",
        status: "pending",
        acbuAmountBurned: new Decimal(acbuNum),
        localCurrency: currency,
        localAmount: new Decimal(localNum),
        recipientAccount: recipient_account as object,
        fee: new Decimal(feeAcbu),
        rateSnapshot: {
          acbu_ngn: null,
          organizationId: req.apiKey?.organizationId ?? null,
          timestamp: new Date().toISOString(),
        },
      },
    });
    await logAudit({
      eventType: "transaction",
      entityType: "transaction",
      entityId: tx.id,
      action: "burn_created",
      newValue: { type: "burn", acbuAmount: acbuNum, currency },
      performedBy: req.apiKey?.userId ?? undefined,
    });

    const addresses = getContractAddresses();
    if (addresses.burning) {
      if (blockchain_tx_hash) {
        await prisma.transaction.update({
          where: { id: tx.id },
          data: {
            status: "processing",
            blockchainTxHash: blockchain_tx_hash,
          },
        });
        res.status(200).json({
          transaction_id: tx.id,
          acbu_amount: String(acbuNum),
          local_amount: String(localNum),
          currency,
          fee: String(feeAcbu),
          rate: { acbu_ngn: null, timestamp: new Date().toISOString() },
          status: "processing",
          estimated_completion: null,
          blockchain_tx_hash,
        });
        return;
      }
      try {
        const sourceAccount = stellarClient.getKeypair()?.publicKey();
        if (!sourceAccount) throw new Error("No source account available");

        const result = await acbuBurningService.redeemSingle({
          user: sourceAccount,
          recipient: sourceAccount, // S-tokens go to backend's wallet for off-ramp processing
          acbuAmount: acbuAmount7,
          currency,
        });
        const localNumFromContract = Number(result.localAmount) / 100; // contract may use 2 decimals for fiat
        await prisma.transaction.update({
          where: { id: tx.id },
          data: {
            status: "processing",
            localAmount: new Decimal(localNumFromContract),
            blockchainTxHash: result.transactionHash,
          },
        });
        res.status(200).json({
          transaction_id: tx.id,
          acbu_amount: String(acbuNum),
          local_amount: String(localNumFromContract),
          currency,
          fee: String(feeAcbu),
          rate: { acbu_ngn: null, timestamp: new Date().toISOString() },
          status: "processing",
          estimated_completion: null,
          blockchain_tx_hash: result.transactionHash,
        });
        return;
      } catch (err) {
        await prisma.transaction.update({
          where: { id: tx.id },
          data: { status: "failed" },
        });
        next(err);
        return;
      }
    }

    res.status(200).json({
      transaction_id: tx.id,
      acbu_amount: String(acbuNum),
      local_amount: null,
      currency,
      fee: String(feeAcbu),
      rate: { acbu_ngn: null, timestamp: new Date().toISOString() },
      status: "pending",
      estimated_completion: null,
    });
  } catch (error) {
    next(error);
  }
}
