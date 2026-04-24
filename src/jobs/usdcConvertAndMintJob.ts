/**
 * USDC deposit: convert USDC→XLM via Stellar DEX (pathPaymentStrictSend),
 * then mint ACBU to the user's wallet.
 *
 * The swap is performed by the backend's configured STELLAR_SECRET_KEY keypair
 * using the Stellar DEX. Minting is only triggered once the on-chain swap
 * transaction is confirmed; if the swap fails the job nacks and retries.
 */
import type { ConsumeMessage } from "amqplib";
import {
  connectRabbitMQ,
  QUEUES,
  assertQueueWithDLQ,
} from "../config/rabbitmq";
import { logger } from "../config/logger";
import { prisma } from "../config/database";
import { mintFromUsdcInternal } from "../controllers/mintController";
import { swapUsdcToXlm } from "../services/stellar/usdcSwap";
import { Decimal } from "@prisma/client/runtime/library";

const QUEUE = QUEUES.USDC_CONVERT_AND_MINT;

export interface UsdcConvertAndMintPayload {
  onRampSwapId: string;
}

export async function startUsdcConvertAndMintConsumer(): Promise<void> {
  const ch = await connectRabbitMQ();
  await assertQueueWithDLQ(QUEUE);
  ch.prefetch(1);
  ch.consume(
    QUEUE,
    async (msg: ConsumeMessage | null) => {
      if (!msg) return;
      try {
        const body = JSON.parse(
          msg.content.toString(),
        ) as UsdcConvertAndMintPayload;
        await processUsdcConvertAndMint(body);
        ch.ack(msg);
      } catch (e) {
        logger.error("USDC convert-and-mint job failed", { error: e });
        ch.nack(msg, false, true);
      }
    },
    { noAck: false },
  );
  logger.info("USDC convert-and-mint consumer started", { queue: QUEUE });
}

export async function processUsdcConvertAndMint(
  payload: UsdcConvertAndMintPayload,
): Promise<void> {
  const { onRampSwapId } = payload;
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
    const { xlmReceived, txHash: swapTxHash } = await swapUsdcToXlm(usdcAmount);

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
    await prisma.onRampSwap.update({
      where: { id: onRampSwapId },
      data: { status: "failed" },
    });
    logger.error("USDC convert-and-mint failed", { onRampSwapId, error: e });
    throw e;
  }
}

export async function enqueueUsdcConvertAndMint(
  payload: UsdcConvertAndMintPayload,
): Promise<void> {
  const ch = await connectRabbitMQ();
  await assertQueueWithDLQ(QUEUE);
  ch.sendToQueue(QUEUE, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
  });
  logger.info("USDC convert-and-mint enqueued", {
    onRampSwapId: payload.onRampSwapId,
  });
}
