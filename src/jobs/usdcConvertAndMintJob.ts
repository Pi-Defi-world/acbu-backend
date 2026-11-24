/**
 * USDC deposit: convert USDC→XLM via Stellar DEX (pathPaymentStrictSend),
 * then mint ACBU to the user's wallet.
 *
 * The swap is performed by the backend's configured STELLAR_SECRET_KEY keypair
 * using the Stellar DEX. Minting is only triggered once the on-chain swap
 * transaction is confirmed; if the swap fails the job nacks and retries.
 */
import type { ConsumeMessage } from "amqplib";
import { connectRabbitMQ, QUEUES, assertQueueWithDLQ } from "../config/rabbitmq";
import { getQueueMaxRetries } from "./queueConfig";
import { logger } from "../config/logger";
import { prisma } from "../config/database";
import { mintFromUsdcInternal } from "../controllers/mintController";
import { swapUsdcToXlm } from "../services/stellar/usdcSwap";
import { Decimal } from "@prisma/client/runtime/library";

const QUEUE = QUEUES.USDC_CONVERT_AND_MINT;
const MAX_RETRIES = getQueueMaxRetries(QUEUE);

export interface UsdcConvertAndMintPayload {
  onRampSwapId: string;
}

export interface UsdcConvertAndMintOptions {
  /**
   * True when the consumer has no retries left for this message. Determines
   * whether a failure parks the swap in `failed` (terminal) or releases the
   * claim back to `pending_convert` so a redelivery can pick it up.
   */
  finalAttempt?: boolean;
}

export async function startUsdcConvertAndMintConsumer(): Promise<void> {
  const ch = await connectRabbitMQ();
  await assertQueueWithDLQ(QUEUE);
  ch.prefetch(1);
  ch.consume(
    QUEUE,
    async (msg: ConsumeMessage | null) => {
      if (!msg) return;

      const headers = msg.properties.headers ?? {};
      const retries = typeof headers["x-retries"] === "number" ? headers["x-retries"] : 0;

      try {
        const body = JSON.parse(msg.content.toString()) as UsdcConvertAndMintPayload;
        // The consumer redelivers this message up to MAX_RETRIES times. Only the
        // attempt that exhausts that budget may mark the swap terminally failed;
        // every earlier attempt has to leave it claimable again.
        await processUsdcConvertAndMint(body, { finalAttempt: retries >= MAX_RETRIES - 1 });
        ch.ack(msg);
      } catch (e) {
        logger.error("USDC convert-and-mint job failed", { error: e });

        // Safely extract onRampSwapId for logging
        let onRampSwapId: string | null = null;
        try {
          const payload = JSON.parse(msg.content.toString()) as UsdcConvertAndMintPayload;
          onRampSwapId = payload.onRampSwapId;
        } catch {
          // ignore parse error, already logged
        }

        if (retries >= MAX_RETRIES) {
          logger.error("USDC convert-and-mint job failed permanently, sending to DLQ", {
            onRampSwapId,
            retries,
          });
          // send to DLQ by nacking without requeue
          ch.nack(msg, false, false);
          return;
        }

        // retry with incremented header
        ch.sendToQueue(QUEUE, msg.content, {
          persistent: true,
          headers: {
            ...headers,
            "x-retries": retries + 1,
          },
        });
        ch.ack(msg);
      }
    },
    { noAck: false },
  );
  logger.info("USDC convert-and-mint consumer started", { queue: QUEUE });
}

export async function processUsdcConvertAndMint(
  payload: UsdcConvertAndMintPayload,
  options: UsdcConvertAndMintOptions = {},
): Promise<void> {
  const { onRampSwapId } = payload;
  const { finalAttempt = false } = options;
  // Atomically claim the swap: only one worker wins when status=pending_convert.
  // updateMany returns { count: 0 } if another worker already transitioned it.
  const claimed = await prisma.onRampSwap.updateMany({
    where: { id: onRampSwapId, status: "pending_convert", source: "usdc_deposit" },
    data: { status: "processing" },
  });
  if (claimed.count === 0) {
    logger.warn(
      "OnRampSwap not found, not a pending USDC deposit, or already claimed by another worker",
      { onRampSwapId },
    );
    return;
  }

  const swap = await prisma.onRampSwap.findUnique({
    where: { id: onRampSwapId },
  });
  if (!swap) {
    logger.error("OnRampSwap disappeared after atomic claim", { onRampSwapId });
    return;
  }

  const usdcAmount = swap.usdcAmount ? Number(swap.usdcAmount) : 0;
  if (usdcAmount <= 0) {
    logger.warn("OnRampSwap has no usdcAmount", { onRampSwapId });
    await prisma.onRampSwap.update({
      where: { id: onRampSwapId },
      data: { status: "failed" },
    });
    return;
  }

  try {
    // ── Step 1: swap USDC→XLM on the Stellar DEX ────────────────────────────
    // This is the real conversion: minting must NOT proceed unless this
    // on-chain transaction is confirmed. swapUsdcToXlm throws on any failure.
    //
    // xlmAmount is written only after the swap returns, so a non-null value
    // means an earlier attempt already moved the funds on-chain. Redoing the
    // swap would spend the same USDC twice, so resume at minting instead.
    let xlmReceived: number;
    if (swap.xlmAmount !== null) {
      xlmReceived = Number(swap.xlmAmount);
      logger.info("USDC→XLM swap already confirmed; resuming at mint", {
        onRampSwapId,
        usdcAmount,
        xlmReceived,
      });
    } else {
      const { xlmReceived: swapped, txHash: swapTxHash } = await swapUsdcToXlm(usdcAmount);
      xlmReceived = swapped;

      // Persist the XLM amount obtained so the record reflects actual reserves.
      await prisma.onRampSwap.update({
        where: { id: onRampSwapId },
        data: { xlmAmount: new Decimal(xlmReceived) },
      });

      logger.info("USDC→XLM swap confirmed; proceeding to mint ACBU", {
        onRampSwapId,
        usdcAmount,
        xlmReceived,
        swapTxHash,
      });
    }

    // ── Step 2: mint ACBU to the user's Stellar wallet ───────────────────────
    const { transactionId, acbuAmount } = await mintFromUsdcInternal(
      usdcAmount,
      swap.stellarAddress,
      swap.userId,
    );
    await prisma.onRampSwap.update({
      where: { id: onRampSwapId },
      data: {
        status: "completed",
        transactionId,
        completedAt: new Date(),
      },
    });
    logger.info("USDC convert-and-mint completed", {
      onRampSwapId,
      userId: swap.userId,
      stellarAddress: swap.stellarAddress,
      usdcAmount,
      xlmReceived,
      acbuAmount,
      transactionId,
    });
  } catch (e) {
    // Hand the swap back to `pending_convert` unless this was the last attempt.
    // Keeping it in `failed` while the message is redelivered made retries a
    // no-op: the claim below only matches `pending_convert`, so every retry
    // found nothing to do and the deposit stayed stuck until an operator
    // intervened.
    await prisma.onRampSwap.update({
      where: { id: onRampSwapId },
      data: { status: finalAttempt ? "failed" : "pending_convert" },
    });
    logger.error("USDC convert-and-mint failed", { onRampSwapId, finalAttempt, error: e });
    throw e;
  }
}

export async function enqueueUsdcConvertAndMint(payload: UsdcConvertAndMintPayload): Promise<void> {
  const ch = await connectRabbitMQ();
  await assertQueueWithDLQ(QUEUE);
  ch.sendToQueue(QUEUE, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
  });
  logger.info("USDC convert-and-mint enqueued", {
    onRampSwapId: payload.onRampSwapId,
  });
}
