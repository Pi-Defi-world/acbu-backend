/**
 * USDC deposit: convert USDC→XLM in backend (LP/swap service), then mint ACBU.
 * Pools and swaps run independently; user does not wait. Mint is approved once conversion succeeds.
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

/**
 * Convert USDC→XLM (stub: backend LP/swap service), then mint ACBU to user.
 * In production, call your USDC/XLM swap or LP service here.
 */
async function convertUsdcToXlm(_usdcAmount: number): Promise<void> {
  // Stub: real implementation would use Stellar AMM, DEX, or P2P service.
  // Pools and swaps run as independent backend services.
  return;
}

export async function processUsdcConvertAndMint(
  payload: UsdcConvertAndMintPayload,
): Promise<void> {
  const { onRampSwapId } = payload;
  const swap = await prisma.onRampSwap.findUnique({
    where: { id: onRampSwapId },
  });
  if (
    !swap ||
    swap.source !== "usdc_deposit" ||
    swap.status !== "pending_convert"
  ) {
    logger.warn("OnRampSwap not found or not a pending USDC deposit", {
      onRampSwapId,
    });
    return;
  }
  const usdcAmount = swap.usdcAmount ? Number(swap.usdcAmount) : 0;
  if (usdcAmount <= 0) {
    logger.warn("OnRampSwap has no usdcAmount", { onRampSwapId });
    return;
  }

  await prisma.onRampSwap.update({
    where: { id: onRampSwapId },
    data: { status: "processing" },
  });

  try {
    await convertUsdcToXlm(usdcAmount);
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
