/**
 * POST /v1/burn/acbu - Burn ACBU for local currency redemption.
 * Creates transaction record; invokes burning contract when configured.
 */
import { Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../config/database";
import { getContractAddresses } from "../config/contracts";
import { acbuBurningService } from "../services/contracts";
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
});

export async function burnAcbu(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    const { acbu_amount, currency, recipient_account } = parsed.data;
    const acbuNum = Number(acbu_amount);
    const burnFeeBps = await getBurnFeeBps(currency);
    const feeAcbu = (acbuNum * burnFeeBps) / 10000;
    const acbuAmount7 = Math.round(acbuNum * DECIMALS_7).toString();

    // SECURITY: Always enforce circuit breaker and withdrawal limits
    // Previously these checks were skipped when req.audience was undefined,
    // allowing bypass of critical financial controls via direct /burn/acbu route
    const paused = await isCurrencyWithdrawalPaused(currency);
    if (paused) {
      res.status(503).json({
        error: "Withdrawal paused for currency",
        code: "CIRCUIT_BREAKER",
        message: `Single-currency withdrawals for ${currency} are temporarily paused (reserve below threshold). Basket withdrawals continue.`,
      });
      return;
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
      try {
        const result = await acbuBurningService.burnForCurrency({
          acbuAmount: acbuAmount7,
          currency,
          recipientAccount: {
            accountNumber: recipient_account.account_number,
            bankCode: recipient_account.bank_code,
            accountName: recipient_account.account_name,
          },
        });
        const localNum = Number(result.localAmount) / 100; // contract may use 2 decimals for fiat
        await prisma.transaction.update({
          where: { id: tx.id },
          data: {
            status: "processing",
            localAmount: new Decimal(localNum),
            blockchainTxHash: result.transactionHash,
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
