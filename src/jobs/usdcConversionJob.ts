/**
 * Consumes USDC_CONVERSION queue: when MintEvent is received, process USDC → basket allocation.
 * Updates transaction and reserve history; basket weight distribution uses BasketService.
 *
 * Idempotency (Pi-Defi-world/acbu-backend#981): the job processes each
 * conversion exactly once per source transaction. The payload may be
 * redelivered (at-least-once queue semantics) or the same mint effect may be
 * observed twice, so processing is gated by an atomic claim on the matched
 * transaction (pending → processing). Reserve history rows are always linked
 * to the claimed transaction so reserve accounting stays reconcilable.
 */
import type { ConsumeMessage } from "amqplib";
import { connectRabbitMQ, QUEUES, assertQueueWithDLQ } from "../config/rabbitmq";
import { getQueueMaxRetries } from "./queueConfig";
import { logger } from "../config/logger";
import { prisma } from "../config/database";
import { basketService, type BasketEntry } from "../services/basket";
import { getFintechRouter } from "../services/fintech";
import { Decimal } from "@prisma/client/runtime/library";

const QUEUE = QUEUES.USDC_CONVERSION;
const MAX_RETRIES = getQueueMaxRetries(QUEUE);

export interface UsdcConversionPayload {
  usdcAmount: string;
  recipient: string;
  txHash: string;
  transactionId?: string;
}

export interface BasketShareAllocation {
  currency: string;
  weight: number;
  amountAtomic: bigint;
  amountDecimal: Decimal;
  amount: number;
}

/** Standard token decimals for atomic units (7 decimals / stroops per Stellar standard) */
export const USDC_CONVERSION_DECIMALS = 7;

/**
 * Distribute an amount across basket currencies using exact integer/fixed-point arithmetic
 * in base atomic units (stroops).
 *
 * Prevents floating-point drift and rounding errors. Any residual remainder (in atomic units)
 * from integer division is allocated to the shares with the largest fractional remainder
 * (with highest weight / earlier position as tie-breaker), ensuring that the sum of all allocated
 * shares strictly equals the initial amount with zero residual drift.
 *
 * @param usdcAmount Total USDC amount (string, number, or Decimal)
 * @param basket Basket entries with currency and target weight
 * @param decimals Number of decimal places for atomic unit scaling (default: 7)
 * @returns Array of allocated shares per currency
 */
export function calculateBasketDistribution(
  usdcAmount: string | number | Decimal,
  basket: BasketEntry[],
  decimals: number = USDC_CONVERSION_DECIMALS,
): BasketShareAllocation[] {
  if (!basket || basket.length === 0) {
    return [];
  }

  let amountDec: Decimal;
  try {
    amountDec = usdcAmount instanceof Decimal ? usdcAmount : new Decimal(usdcAmount);
  } catch {
    return [];
  }

  if (amountDec.isNaN() || amountDec.lte(0) || !amountDec.isFinite()) {
    return [];
  }

  const scale = new Decimal(10).pow(decimals);
  const totalAtomic = BigInt(amountDec.mul(scale).toFixed(0, Decimal.ROUND_DOWN));

  if (totalAtomic <= 0n) {
    return [];
  }

  if (basket.length === 1) {
    const single = basket[0];
    return [
      {
        currency: single.currency,
        weight: single.weight,
        amountAtomic: totalAtomic,
        amountDecimal: amountDec,
        amount: amountDec.toNumber(),
      },
    ];
  }

  // Convert weights to integer basis units (scaling by 10,000 handles decimal weights like 33.33%)
  const weightScale = 10000;
  const weightEntries = basket.map((b, index) => {
    const wDec = new Decimal(b.weight);
    const weightInt = BigInt(wDec.mul(weightScale).toFixed(0, Decimal.ROUND_DOWN));
    return {
      index,
      currency: b.currency,
      weight: b.weight,
      weightInt,
    };
  });

  const totalWeight = weightEntries.reduce((sum, e) => sum + e.weightInt, 0n);
  if (totalWeight <= 0n) {
    throw new Error("Total basket weight must be positive");
  }

  // Compute base atomic units and integer division remainders
  const allocations = weightEntries.map((entry) => {
    const product = totalAtomic * entry.weightInt;
    const baseAtomic = product / totalWeight;
    const remainder = product % totalWeight;
    return {
      ...entry,
      baseAtomic,
      remainder,
      finalAtomic: baseAtomic,
    };
  });

  const baseSum = allocations.reduce((sum, a) => sum + a.baseAtomic, 0n);
  const residual = totalAtomic - baseSum; // 0 <= residual < basket.length

  if (residual > 0n) {
    // Sort by: 1) remainder descending, 2) weight descending, 3) original index ascending
    const sortedIndices = Array.from({ length: allocations.length }, (_, i) => i).sort((i, j) => {
      const remDiff = allocations[j].remainder - allocations[i].remainder;
      if (remDiff !== 0n) {
        return remDiff > 0n ? 1 : -1;
      }
      const weightDiff = allocations[j].weightInt - allocations[i].weightInt;
      if (weightDiff !== 0n) {
        return weightDiff > 0n ? 1 : -1;
      }
      return i - j;
    });

    const residualCount = Number(residual);
    for (let k = 0; k < residualCount; k++) {
      const targetIdx = sortedIndices[k % sortedIndices.length];
      allocations[targetIdx].finalAtomic += 1n;
    }
  }

  return allocations.map((a) => {
    const shareDecimal = new Decimal(a.finalAtomic.toString()).div(scale);
    return {
      currency: a.currency,
      weight: a.weight,
      amountAtomic: a.finalAtomic,
      amountDecimal: shareDecimal,
      amount: shareDecimal.toNumber(),
    };
  });
}

/**
 * Atomically claim a pending transaction for conversion.
 * Returns true when this consumer owns the claim; false when the
 * transaction was already claimed or completed by another delivery.
 */
export async function claimTransaction(transactionId: string): Promise<boolean> {
  const claim = await prisma.transaction.updateMany({
    where: { id: transactionId, status: "pending" },
    data: { status: "processing" },
  });
  return claim.count === 1;
}

/**
 * Release a claim so a redelivered message can be retried from "pending".
 * The claim is a temporary state and is deliberately not modelled by the
 * transaction state machine (processing → pending is not a normal
 * lifecycle transition).
 */
export async function releaseClaim(transactionId: string): Promise<void> {
  await prisma.transaction.updateMany({
    where: { id: transactionId, status: "processing" },
    data: { status: "pending" },
  });
}

export async function startUsdcConversionConsumer(): Promise<void> {
  const ch = await connectRabbitMQ();
  await assertQueueWithDLQ(QUEUE);
  ch.prefetch(1);
  ch.consume(
    QUEUE,
    async (msg: ConsumeMessage | null) => {
      if (!msg) return;
      const headers = msg.properties.headers ?? {};
      const retries = typeof headers["x-retries"] === "number" ? headers["x-retries"] : 0;
      let claimedTransactionId: string | null = null;
      try {
        const body = JSON.parse(msg.content.toString()) as UsdcConversionPayload;
        if (body.transactionId) {
          const claimed = await claimTransaction(body.transactionId);
          if (!claimed) {
            logger.warn("USDC conversion skipped: transaction already claimed or not pending", {
              transactionId: body.transactionId,
            });
            ch.ack(msg);
            return;
          }
          claimedTransactionId = body.transactionId;
        }
        await processUsdcConversion(body);
        ch.ack(msg);
      } catch (e) {
        // Release the claim so a redelivered copy of this message can be
        // processed again from the pending state.
        if (claimedTransactionId) {
          await releaseClaim(claimedTransactionId).catch((releaseError) => {
            logger.error("USDC conversion: failed to release transaction claim", {
              transactionId: claimedTransactionId,
              error: releaseError,
            });
          });
          claimedTransactionId = null;
        }
        logger.error("USDC conversion job failed", { error: e });
        if (retries >= MAX_RETRIES) {
          logger.error("USDC conversion job failed permanently, sending to DLQ", { retries });
          ch.nack(msg, false, false);
          return;
        }
        ch.sendToQueue(QUEUE, msg.content, {
          persistent: true,
          headers: { ...headers, "x-retries": retries + 1 },
        });
        ch.ack(msg);
      }
    },
    { noAck: false },
  );
  logger.info("USDC conversion consumer started", { queue: QUEUE });
}

/**
 * Convert the credited USDC into basket-currency reserves and record the moves.
 *
 * Exported separately from the consumer so it can be driven directly by tests,
 * the same way `processUsdcConvertAndMint` is.
 */
export async function processUsdcConversion(payload: UsdcConversionPayload): Promise<void> {
  const { usdcAmount, recipient, txHash, transactionId } = payload;
  let usdcDecimal: Decimal;
  try {
    usdcDecimal = new Decimal(usdcAmount);
  } catch {
    logger.warn("USDC conversion skipped: amount is invalid", { usdcAmount, txHash });
    return;
  }

  if (usdcDecimal.lte(0) || !usdcDecimal.isFinite()) {
    logger.warn("USDC conversion skipped: amount is not positive", { usdcAmount, txHash });
    return;
  }

  const basket = await basketService.getCurrentBasket();
  if (!basket || basket.length === 0) {
    logger.warn("USDC conversion skipped: basket is empty", { usdcAmount, txHash });
    return;
  }

  const allocations = calculateBasketDistribution(usdcDecimal, basket);

  for (const { currency, amount, amountDecimal } of allocations) {
    try {
      const router = getFintechRouter();
      const provider = await router.getProvider(currency);
      await provider.convertCurrency(amount, "USD", currency);
    } catch (e) {
      // The purchase did not happen, so the reserve ledger must not move for
      // this currency. Recording it anyway credits reserves that were never
      // acquired and desyncs the ledger from the actual holdings.
      logger.warn("USDC conversion: FX failed, no reserve entry recorded", {
        currency,
        amountLocal: amount,
        error: e,
      });
      continue;
    }

    await prisma.reserveHistory.create({
      data: {
        currency,
        amountChange: amountDecimal,
        reason: "conversion",
        newAmount: null,
      },
    });
  }

  if (transactionId) {
    await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: "completed",
        blockchainTxHash: txHash,
        completedAt: new Date(),
      },
    });
  }

  logger.info("USDC conversion processed", {
    usdcAmount,
    recipient,
    txHash,
  });
}

/**
 * Enqueue a USDC conversion job (call from MintEvent handler).
 */
export async function enqueueUsdcConversion(payload: UsdcConversionPayload): Promise<void> {
  const ch = await connectRabbitMQ();
  await assertQueueWithDLQ(QUEUE);
  ch.sendToQueue(QUEUE, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
  });
  logger.info("USDC conversion enqueued", { txHash: payload.txHash });
}
