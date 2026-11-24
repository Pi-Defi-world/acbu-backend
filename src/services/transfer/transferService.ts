/**
 * Transfer service: resolve alias to stellarAddress, create Transaction, optionally submit Stellar payment.
 * Uses direct wallets (G...). When getSenderSigningKey is provided, signs and submits; otherwise leaves pending.
 */
import { Operation, Asset, Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database";
import { stellarClient } from "../stellar/client";
import { getBaseFee, getPaymentFee } from "../stellar/feeManager";
import type { PaymentFeeQuote } from "../stellar/feeManager";
import { normalizeRecipientQuery, resolveRecipient } from "../recipient/recipientResolver";
import { getAcbuAsset } from "../../config/acbuAsset";
import { StellarFeeSurgeError } from "../../errors";
import crypto from "crypto";
import { reserveWalletVersion, fetchWalletBalance } from "../wallet/walletStateService";
import { config } from "../../config/env";

import { logger, logFinancialEvent } from "../../config/logger";
import { logAudit } from "../audit";
import type { CreateTransferParams, CreateTransferOptions, CreateTransferResult } from "./types";

/**
 * W10-BE-008: money-moving transfers must carry an idempotency key so a client
 * timeout/retry cannot create a duplicate transaction row or a duplicate Stellar
 * payment. Enforced here (server-side) in addition to the controller check so
 * no caller can bypass it.
 */
function requireIdempotencyKey(idempotencyKey: string | undefined | null): string {
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
    throw new Error("Idempotency key is required for transfers");
  }
  return idempotencyKey.trim();
}

/** Parse a non-negative amount string into 7-decimal smallest units to avoid float drift. */
function amountToSmallestUnit(amount: string): number {
  const [wholePart, fracPart = ""] = amount.split(".");
  return parseInt(wholePart, 10) * 10000000 + parseInt(fracPart.slice(0, 7).padEnd(7, "0"), 10);
}

/**
 * Resolve an alias (@user, E.164, email) or raw G... to a Stellar address.
 * Raw addresses pass through shape-validated by normalizeRecipientQuery; aliases
 * go through resolveRecipient + user lookup. Returns null when unresolvable.
 */
async function resolveRecipientAddress(to: string, callerUserId: string): Promise<string | null> {
  const parsed = normalizeRecipientQuery(to);
  if (parsed.kind === "address") {
    return parsed.value;
  }
  const recipient = await resolveRecipient(to, callerUserId);
  if (!recipient) {
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: recipient.userId },
    select: { stellarAddress: true },
  });
  return user?.stellarAddress ?? null;
}

/**
 * AB-052: build + submit attempts allowed for a single payment before an
 * underpriced transaction is surfaced to the caller as a StellarFeeSurgeError.
 * Each retry is safe: nothing has been submitted yet, so no sequence number is
 * consumed and no funds have moved.
 */
const MAX_SUBMIT_ATTEMPTS = 3;

/**
 * How long a built payment transaction stays valid on-chain, in seconds.
 *
 * Required: `@stellar/stellar-base` v15 refuses to `build()` a transaction
 * without TimeBounds ("TimeBounds has to be set or you must call
 * setTimeout(TimeoutInfinite)"). A bounded window is preferred over
 * `TimeoutInfinite` because it caps how long a repriced transaction can linger
 * and still be included — relevant here, where a transaction may be rebuilt
 * several times while the network fee is moving.
 */
const PAYMENT_VALIDITY_SECONDS = 60;

/**
 * #1142: Travel Rule compliance check for P2P transfers.
 *
 * Direct P2P transfers between non-custodied wallets cannot satisfy Travel Rule
 * originator/beneficiary data requirements because the blockchain layer only
 * carries addresses, not KYC/identity information. This creates a compliance gap
 * for transfers above regulatory thresholds.
 *
 * The check logs a warning when the transfer amount exceeds the threshold.
 * When enforcement is enabled via TRAVEL_RULE_ENFORCE=true, it rejects transfers
 * that cannot be verified as compliant (e.g., direct wallet-to-wallet transfers).
 *
 * @param amountAcbu - Transfer amount in ACBU
 * @param isVaspIntermediated - Whether the transfer is intermediated by a VASP
 * @param recipientAddress - The recipient's Stellar address
 * @returns true if compliant, false if non-compliant and enforcement is enabled
 */
function checkTravelRuleCompliance(
  amountAcbu: string,
  isVaspIntermediated: boolean,
  recipientAddress: string,
): boolean {
  const threshold = config.travelRule.thresholdAcbu;
  const amount = Number.parseFloat(amountAcbu);

  // Only check amounts above the threshold
  if (amount <= threshold) {
    return true;
  }

  const { enforce, mode } = config.travelRule;

  // Log compliance check for audit trail
  logger.warn("Travel Rule compliance check", {
    amountAcbu,
    threshold,
    enforce,
    mode,
    isVaspIntermediated,
    recipientAddress,
  });

  // In allowlist mode, only VASP-intermediated transfers are allowed above threshold
  if (mode === "allowlist" && !isVaspIntermediated) {
    if (enforce) {
      logger.error("Travel Rule violation: direct P2P transfer above threshold not allowed in allowlist mode", {
        amountAcbu,
        threshold,
        recipientAddress,
      });
      return false;
    }
    logger.warn("Travel Rule limitation: direct P2P transfer above threshold (allowlist mode, not enforced)", {
      amountAcbu,
      threshold,
      recipientAddress,
    });
  }

  // In strict mode, all transfers above threshold require VASP intermediation
  if (mode === "strict" && !isVaspIntermediated) {
    if (enforce) {
      logger.error("Travel Rule violation: direct P2P transfer above threshold not allowed in strict mode", {
        amountAcbu,
        threshold,
        recipientAddress,
      });
      return false;
    }
    logger.warn("Travel Rule limitation: direct P2P transfer above threshold (strict mode, not enforced)", {
      amountAcbu,
      threshold,
      recipientAddress,
    });
  }

  return true;
}

/**
 * Horizon/Stellar result codes that unambiguously mean "the fee on this
 * transaction was below the network's base fee".
 *
 * `tx_fee_bump_inner_failed` is deliberately *not* here: it is the wrapper's
 * code for *any* failed inner transaction, so treating it as a fee rejection
 * would misattribute a bad signature, insufficient balance, or missing source
 * account as a fee surge and burn the retry budget rediscovering it. It is
 * handled separately in {@link isInsufficientFeeRejection}, which only accepts
 * it once the inner result codes also indicate underpricing.
 */
const INSUFFICIENT_FEE_RESULT_CODES = new Set(["tx_insufficient_fee"]);

/** Outer code used when the inner transaction of a fee-bump wrapper fails. */
const FEE_BUMP_INNER_FAILED = "tx_fee_bump_inner_failed";

/** Audit fields attached to fee-related log lines so a surge can be traced back to a transfer. */
export interface SubmitStellarPaymentLogContext {
  transactionId?: string;
  correlationId?: string;
}

/** The subset of Horizon's `extras` payload that carries transaction result codes. */
interface HorizonResultCodes {
  transaction?: string;
  operations?: string[];
  transactions?: string[];
}

type HorizonExtras = {
  result_codes?: HorizonResultCodes;
  result_codes_transactions?: string[];
};

/**
 * Detect a Horizon rejection caused by an underpriced transaction.
 *
 * Horizon reports the reason in `response.data.extras.result_codes`, but that
 * shape is absent when the request never reached Horizon (timeouts, 5xx) and the
 * code can also arrive as a bare error message, so both are inspected.
 */
function isInsufficientFeeRejection(error: unknown): boolean {
  const candidate = error as
    | {
        message?: unknown;
        response?: {
          data?: {
            extras?: HorizonExtras;
          };
        };
      }
    | null
    | undefined;

  const extras = candidate?.response?.data?.extras;
  const resultCodes = extras?.result_codes;
  const message = typeof candidate?.message === "string" ? candidate.message : null;

  if (message?.includes("tx_insufficient_fee")) {
    return true;
  }

  if (resultCodes?.transaction && INSUFFICIENT_FEE_RESULT_CODES.has(resultCodes.transaction)) {
    return true;
  }
  if (
    Array.isArray(resultCodes?.operations) &&
    resultCodes.operations.some((code) => INSUFFICIENT_FEE_RESULT_CODES.has(code))
  ) {
    return true;
  }

  // A failed fee-bump wrapper only counts as a fee problem when the inner
  // transaction's own codes say it was underpriced.
  if (resultCodes?.transaction === FEE_BUMP_INNER_FAILED) {
    const innerCodes = [
      ...(extras?.result_codes_transactions ?? []),
      ...(resultCodes?.transactions ?? []),
    ];
    return innerCodes.some((code) => INSUFFICIENT_FEE_RESULT_CODES.has(code));
  }

  return typeof message === "string" ? INSUFFICIENT_FEE_RESULT_CODES.has(message.trim()) : false;
}

/** Outcome of re-reading the network base fee immediately before submission. */
interface FeeRevalidation {
  /** True when the fee already on the built transaction is still high enough. */
  current: boolean;
  /** The freshly read network base fee, or null when it could not be read. */
  networkFeeStroops: number | null;
}

/**
 * Re-read the network base fee and check it against the fee on a built
 * transaction, immediately before that transaction is submitted.
 *
 * Building and submitting a transaction are separated by a network round trip,
 * during which the base fee can rise — which is what turns a correctly priced
 * transfer into a `tx_insufficient_fee` rejection under load. Comparing against
 * a freshly read fee converts that certain on-chain rejection into a cheap
 * local rebuild. When the read fails the transaction is submitted as priced: an
 * unavailable check must never block an otherwise valid payment.
 */
async function revalidateFeeBeforeSubmit(builtQuote: PaymentFeeQuote): Promise<FeeRevalidation> {
  let networkFeeStroops: number;
  try {
    networkFeeStroops = Number.parseInt(await getBaseFee(), 10);
  } catch (err) {
    logger.warn("Could not re-validate Stellar fee before submission; submitting as priced", {
      feeStroops: builtQuote.feeStroops,
      err,
    });
    return { current: true, networkFeeStroops: null };
  }

  if (!Number.isFinite(networkFeeStroops)) {
    logger.warn("Stellar fee re-validation returned a non-numeric fee; submitting as priced", {
      feeStroops: builtQuote.feeStroops,
      networkFeeStroops,
    });
    return { current: true, networkFeeStroops: null };
  }

  return {
    current: builtQuote.feeStroops >= networkFeeStroops,
    networkFeeStroops,
  };
}

/**
 * Build, sign with sender key, and submit a Stellar payment. Returns hash or throws.
 *
 * The fee is not resolved once per call. It is re-read on every attempt and
 * re-validated immediately before submission, so a base-fee increase that lands
 * after the transaction is built is absorbed by rebuilding rather than by losing
 * the payment to `tx_insufficient_fee` (AB-052)
 */
export async function createTransfer(
  params: CreateTransferParams,
  options: CreateTransferOptions = {}
): Promise<CreateTransferResult> {
  // W10-BE-008: reject money-moving transfers that lack an idempotency key
  // before any transaction row is created or any Stellar payment is submitted.
  const idempotencyKey = requireIdempotencyKey(params.idempotencyKey);

  const { fromUserId, to, amount, currency = "ACBU", memo } = params;
  const { getSenderSigningKey, correlationId } = options;

  const sender = await prisma.user.findUnique({
    where: { id: fromUserId },
    select: { id: true, stellarAddress: true },
  });
  if (!sender?.stellarAddress) {
    throw new Error("Sender has no Stellar address");
  }

  const recipientAddress = await resolveRecipientAddress(to, fromUserId);
  if (!recipientAddress) {
    throw new Error("Recipient could not be resolved");
  }

  const amountSmallest = amountToSmallestUnit(amount);
  if (!Number.isFinite(amountSmallest) || amountSmallest <= 0) {
    throw new Error("Invalid transfer amount");
  }

  const existing = await prisma.transaction.findUnique({
    where: { idempotencyKey },
    select: { id: true, status: true, stellarTxHash: true },
  });
  if (existing) {
    return {
      transactionId: existing.id,
      status: existing.status,
      stellarTxHash: existing.stellarTxHash ?? undefined,
    };
  }

  const transaction = await prisma.transaction.create({
    data: {
      userId: fromUserId,
      type: "transfer",
      amount: new Prisma.Decimal(amount),
      currency,
      status: "pending",
      idempotencyKey,
      metadata: {
        to,
        recipientAddress,
        memo: memo ?? null,
        correlationId: correlationId ?? null,
      },
    },
  });

  if (!getSenderSigningKey) {
    return { transactionId: transaction.id, status: "pending" };
  }

  const signingKey = await getSenderSigningKey();
  const senderKeypair = Keypair.fromSecret(signingKey);
  const acbuAsset = getAcbuAsset();

  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_SUBMIT_ATTEMPTS; attempt++) {
    const quote = await getPaymentFee();
    const account = await stellarClient.loadAccount(sender.stellarAddress);
    const tx = new TransactionBuilder(account, {
      fee: String(quote.feeStroops),
      networkPassphrase: stellarClient.getNetworkPassphrase(),
    })
      .addOperation(
        Operation.payment({
          destination: recipientAddress,
          asset: acbuAsset,
          amount,
        })
      )
      .setTimeout(PAYMENT_VALIDITY_SECONDS)
      .build();

    tx.sign(senderKeypair);

    const revalidation = await revalidateFeeBeforeSubmit(quote);
    if (!revalidation.current) {
      logger.warn("Stellar base fee rose before submission; rebuilding transaction", {
        transactionId: transaction.id,
        correlationId,
        builtFeeStroops: quote.feeStroops,
        networkFeeStroops: revalidation.networkFeeStroops,
      });
      continue;
    }

    try {
      const result = await stellarClient.submitTransaction(tx);
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: "completed", stellarTxHash: result.hash },
      });
      logFinancialEvent("transfer.completed", {
        transactionId: transaction.id,
        correlationId,
        stellarTxHash: result.hash,
      });
      return {
        transactionId: transaction.id,
        status: "completed",
        stellarTxHash: result.hash,
      };
    } catch (err) {
      lastError = err;
      if (!isInsufficientFeeRejection(err)) {
        throw err;
      }
      logger.warn("Stellar rejected underpriced payment; retrying with fresh fee", {
        transactionId: transaction.id,
        correlationId,
        attempt,
      });
    }
  }

  // Unreachable: every iteration of the loop either returns a hash or throws.
  throw new Error("Stellar payment submission ended without a result");
}

/**
 * Create a transfer: resolve recipient, create Transaction row, optionally submit Stellar payment.
 * When getSenderSigningKey is not provided or returns null, status remains 'pending'.
 *
 * Throws {@link StellarFeeSurgeError} when the network fee is above the
 * configured payment ceiling or a payment is rejected for underpricing and
 * cannot be repriced. The Transaction row is still marked `failed` and a
 * `transfer.failed` event is emitted first, so a rethrow never leaves an
 * orphaned or inconsistent record. The error is a 503: nothing was submitted
 * and no funds moved, so the caller may retry. All other submission failures
 * resolve to a `failed` status rather than throwing (AB-052).
 */
export async function createTransfer(
  params: CreateTransferParams,
  options?: CreateTransferOptions,
): Promise<CreateTransferResult> {
  const { senderUserId, to, idempotencyKey } = params;
  const amount = params.amountAcbu.trim();
  // Reject scientific notation and enforce up to 7 decimal places (Stellar max precision)
  if (!amount || !/^\d+(\.\d{1,7})?$/.test(amount) || Number(amount) <= 0) {
    throw new Error("amount_acbu must be a positive number with up to 7 decimal places");
  }
  const amountInSmallestUnit = amountToSmallestUnit(amount);

  const sender = await prisma.user.findUnique({
    where: { id: senderUserId },
    select: { stellarAddress: true, kycStatus: true },
  });
  if (!sender) {
    throw new Error("Sender user not found");
  }
  if (sender.kycStatus !== "verified") {
    throw new Error("KYC required to make payments. Complete verification first.");
  }

  if (idempotencyKey) {
    const existingTransfer = await prisma.transaction.findFirst({
      where: {
        idempotencyKey,
        userId: senderUserId,
        type: "transfer",
      },
    });
    if (existingTransfer) {
      return {
        transactionId: existingTransfer.id,
        status: existingTransfer.status,
      };
    }
  }

  await reserveWalletVersion(senderUserId, options?.ifMatch);

  const balanceSnapshot = await fetchWalletBalance(senderUserId);
  const balanceInSmallestUnit = amountToSmallestUnit(balanceSnapshot.snapshot.balance || "0");
  if (balanceInSmallestUnit < amountInSmallestUnit) {
    throw new Error("Insufficient balance");
  }

  const recipientAddress = await resolveRecipientAddress(to, senderUserId);
  if (!recipientAddress) {
    throw new Error("Recipient not found or not available");
  }

  // Prevent self-transfer
  if (sender.stellarAddress && recipientAddress === sender.stellarAddress) {
    throw new Error("Cannot transfer to yourself");
  }

  // #1142: Travel Rule compliance check
  // Direct P2P transfers (non-VASP-intermediated) above threshold are flagged/rejected
  const isVaspIntermediated = false; // Current implementation is direct wallet-to-wallet
  const isTravelRuleCompliant = checkTravelRuleCompliance(amount, isVaspIntermediated, recipientAddress);
  if (!isTravelRuleCompliant) {
    throw new Error(
      `Transfer amount ${amount} ACBU exceeds Travel Rule threshold of ${config.travelRule.thresholdAcbu} ACBU. ` +
        "Direct P2P transfers cannot satisfy Travel Rule requirements. " +
        "Use on/off-ramp services or enable VASP intermediation for compliance.",
    );
  }

  let tx;
  try {
    tx = await prisma.transaction.create({
      data: {
        userId: senderUserId,
        type: "transfer",
        status: "pending",
        recipientAddress,
        acbuAmount: amount,
        idempotencyKey: idempotencyKey ?? undefined,
      },
    });
  } catch (createError) {
    if (
      idempotencyKey &&
      createError instanceof Prisma.PrismaClientKnownRequestError &&
      createError.code === "P2002"
    ) {
      const existingTransfer = await prisma.transaction.findFirst({
        where: {
          idempotencyKey,
          userId: senderUserId,
          type: "transfer",
        },
      });
      if (existingTransfer) {
        return {
          transactionId: existingTransfer.id,
          status: existingTransfer.status,
        };
      }
    }
    throw createError;
  }

  const correlationId = options?.correlationId ?? crypto.randomUUID();

  // Emit transfer.initiated immediately after the Transaction row is created
  logFinancialEvent({
    event: "transfer.initiated",
    status: "pending",
    transactionId: tx.id,
    idempotencyKey: idempotencyKey ?? tx.id,
    userId: senderUserId,
    accountId: sender.stellarAddress ?? senderUserId,
    destinationId: recipientAddress,
    amount: amountInSmallestUnit,
    currency: "ACBU",
    correlationId,
  });

  // Audit trail: record that a transfer was initiated (W10-OBS-006)
  await logAudit({
    eventType: "transaction",
    entityType: "transaction",
    entityId: tx.id,
    action: "transfer_initiated",
    newValue: {
      type: "transfer",
      recipientAddress,
      amount: amount,
      currency: "ACBU",
    },
    performedBy: senderUserId,
  }).catch((auditErr) => {
    logger.error("Audit log failed for transfer_initiated", {
      transactionId: tx.id,
      error: auditErr instanceof Error ? auditErr.message : String(auditErr),
    });
  });

  let status = "pending";
  let blockchainTxHash: string | null = null;

  if (options?.submittedBlockchainTxHash) {
    blockchainTxHash = options.submittedBlockchainTxHash;
    status = "completed";
    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        status: "completed",
        blockchainTxHash,
        completedAt: new Date(),
      },
    });
    // Emit transfer.completed for pre-submitted hash path
    logFinancialEvent({
      event: "transfer.completed",
      status: "success",
      transactionId: tx.id,
      idempotencyKey: tx.id,
      userId: senderUserId,
      accountId: sender.stellarAddress ?? senderUserId,
      destinationId: recipientAddress,
      amount: amountInSmallestUnit,
      currency: "ACBU",
      correlationId,
      providerRef: blockchainTxHash,
    });

    // Audit trail: record transfer completion (W10-OBS-006)
    await logAudit({
      eventType: "transaction",
      entityType: "transaction",
      entityId: tx.id,
      action: "transfer_completed",
      newValue: {
        type: "transfer",
        status: "completed",
        recipientAddress,
        amount: amount,
        currency: "ACBU",
        blockchainTxHash,
      },
      performedBy: senderUserId,
    }).catch((auditErr) => {
      logger.error("Audit log failed for transfer_completed", {
        transactionId: tx.id,
        error: auditErr instanceof Error ? auditErr.message : String(auditErr),
      });
    });

    return {
      transactionId: tx.id,
      status,
    };
  }

  const getKey = options?.getSenderSigningKey;
  if (getKey) {
    const secretKey = await getKey(senderUserId);
    if (secretKey) {
      try {
        const asset = getAcbuAsset();
        blockchainTxHash = await submitStellarPayment(secretKey, recipientAddress, amount, asset, {
          transactionId: tx.id,
          correlationId,
        });
        status = "completed";
        await prisma.transaction.update({
          where: { id: tx.id },
          data: {
            status: "completed",
            blockchainTxHash,
            completedAt: new Date(),
          },
        });
        logger.info("Transfer completed", {
          transactionId: tx.id,
          blockchainTxHash,
          senderUserId,
        });
        // Emit transfer.completed on successful Stellar submission
        logFinancialEvent({
          event: "transfer.completed",
          status: "success",
          transactionId: tx.id,
          idempotencyKey: tx.id,
          userId: senderUserId,
          accountId: sender.stellarAddress ?? senderUserId,
          destinationId: recipientAddress,
          amount: amountInSmallestUnit,
          currency: "ACBU",
          correlationId,
          providerRef: blockchainTxHash,
        });

        // Audit trail: record transfer completion (W10-OBS-006)
        await logAudit({
          eventType: "transaction",
          entityType: "transaction",
          entityId: tx.id,
          action: "transfer_completed",
          newValue: {
            type: "transfer",
            status: "completed",
            recipientAddress,
            amount: amount,
            currency: "ACBU",
            blockchainTxHash,
          },
          performedBy: senderUserId,
        }).catch((auditErr) => {
          logger.error("Audit log failed for transfer_completed", {
            transactionId: tx.id,
            error: auditErr instanceof Error ? auditErr.message : String(auditErr),
          });
        });
      } catch (err) {
        // A fee surge is a distinct, retryable condition: the payment was never
        // accepted, so nothing moved. Record it with its own error code instead
        // of folding it into the generic "submission failed" bucket (AB-052).
        const isFeeSurge = err instanceof StellarFeeSurgeError;
        logger.error("Transfer Stellar submission failed", {
          transactionId: tx.id,
          senderUserId,
          error: err,
          ...(isFeeSurge
            ? {
                errorCode: err.code,
                networkFeeStroops: err.networkFeeStroops,
                transactionFeeStroops: err.transactionFeeStroops,
                maxFeeStroops: err.maxFeeStroops,
                detectedBy: err.detectedBy,
              }
            : {}),
        });
        status = "failed";
        await prisma.transaction.update({
          where: { id: tx.id },
          data: { status: "failed" },
        });
        // Emit transfer.failed on Stellar submission failure
        logFinancialEvent({
          event: "transfer.failed",
          status: "failed",
          transactionId: tx.id,
          idempotencyKey: tx.id,
          userId: senderUserId,
          accountId: sender.stellarAddress ?? senderUserId,
          destinationId: recipientAddress,
          amount: amountInSmallestUnit,
          currency: "ACBU",
          correlationId,
          errorCode: isFeeSurge ? err.code : undefined,
          errorMessage: err instanceof Error ? err.message : String(err),
        });

        // Audit trail: record transfer failure (W10-OBS-006)
        await logAudit({
          eventType: "transaction",
          entityType: "transaction",
          entityId: tx.id,
          action: "transfer_failed",
          newValue: {
            type: "transfer",
            status: "failed",
            recipientAddress,
            amount: amount,
            currency: "ACBU",
            errorCode: isFeeSurge ? err.code : undefined,
            errorMessage: err instanceof Error ? err.message : String(err),
          },
          performedBy: senderUserId,
        }).catch((auditErr) => {
          logger.error("Audit log failed for transfer_failed", {
            transactionId: tx.id,
            error: auditErr instanceof Error ? auditErr.message : String(auditErr),
          });
        });

        // A fee surge is retryable and no funds moved, so the caller is told
        // explicitly rather than receiving an indistinguishable "failed" result
        // that reads like a permanent problem. Only this error type is
        // rethrown: every other submission failure keeps its existing behaviour
        // of resolving to a failed transfer, since those are not transient and
        // retrying them is the caller's decision (AB-052).
        if (isFeeSurge) {
          throw err;
        }
      }
    }
  }

  return {
    transactionId: tx.id,
    status,
  };
}
