/**
 * POST /v1/burn/acbu - Burn ACBU for local currency redemption.
 * Creates transaction record; invokes burning contract when configured.
 */
import { Response, NextFunction } from "express";
import { z } from "zod";
import { Prisma, Transaction } from "@prisma/client";
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

/** Best-effort stringify for Decimal-like values in Prisma models. */
function toNullableStringDecimal(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && v !== null && "toString" in v) {
    return String((v as { toString: () => string }).toString());
  }
  return null;
}

/** Formats an idempotent response using the existing burn transaction record. */
function respondFromExistingBurnTx(
  res: Response,
  tx: Transaction,
  blockchainTxHash: string,
): void {
  res.status(200).json({
    transaction_id: tx.id,
    acbu_amount: toNullableStringDecimal(tx.acbuAmountBurned),
    local_amount: toNullableStringDecimal(tx.localAmount),
    currency: tx.localCurrency,
    fee: toNullableStringDecimal(tx.fee),
    rate:
      tx.rateSnapshot ??
      ({ acbu_ngn: null, timestamp: tx.createdAt.toISOString() } as const),
    status: tx.status,
    estimated_completion: null,
    blockchain_tx_hash: blockchainTxHash,
  });
}

const recipientAccountSchema = z.object({
  type: z.enum(["bank", "mobile_money"]).optional(),
  account_number: z.string().min(1),
  bank_code: z.string().min(1),
  account_name: z.string().min(1),
});

export const bodySchema = z.object({
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
      res
        .status(400)
        .json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    const { acbu_amount, currency, recipient_account, blockchain_tx_hash } =
      parsed.data;

    const addresses = getContractAddresses();
    const burningEnabled = Boolean(addresses.burning);
    if (burningEnabled && blockchain_tx_hash) {
      const existing = await prisma.transaction.findFirst({
        where: { type: "burn", blockchainTxHash: blockchain_tx_hash },
      });
      if (existing) {
        respondFromExistingBurnTx(res, existing, blockchain_tx_hash);
        return;
      }
    }

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
        organizationId: req.apiKey?.organizationId ?? undefined,
        type: "burn",
        status: "pending",
        acbuAmountBurned: new Decimal(acbuNum),
        localCurrency: currency,
        localAmount: new Decimal(localNum),
        recipientAccount: recipient_account as object,
        fee: new Decimal(feeAcbu),
        rateSnapshot: {
          acbu_ngn: null,
          timestamp: new Date().toISOString(),
        },
      },
      blockchainTxHash:
        burningEnabled && blockchain_tx_hash ? blockchain_tx_hash : undefined,
    };

    let tx: Transaction;
    try {
      tx = await prisma.transaction.create({ data: createData });
    } catch (err) {
      // Idempotency: if another request created the same hash concurrently, return the original record.
      if (
        burningEnabled &&
        blockchain_tx_hash &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const existing = await prisma.transaction.findFirst({
          where: { type: "burn", blockchainTxHash: blockchain_tx_hash },
        });
        if (existing) {
          respondFromExistingBurnTx(res, existing, blockchain_tx_hash);
          return;
        }
      }
      throw err;
    }
    await logAudit({
      eventType: "transaction",
      entityType: "transaction",
      entityId: tx.id,
      action: "burn_created",
      newValue: { type: "burn", acbuAmount: acbuNum, currency },
      performedBy: req.apiKey?.userId ?? undefined,
    });

    if (burningEnabled) {
      if (blockchain_tx_hash) {
        respondFromExistingBurnTx(res, tx, blockchain_tx_hash);
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
