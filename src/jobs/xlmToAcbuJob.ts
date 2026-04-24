/**
 * XLM→ACBU job: processes USDC on-ramp. User swapped USDC for XLM on Stellar LP;
 * this job "sells" XLM (or uses equivalent value) and mints ACBU to the user.
 * Consumes XLM_TO_ACBU queue or polls OnRampSwap table for pending_convert.
 */
import type { ConsumeMessage } from "amqplib";
import { connectRabbitMQ, QUEUES } from "../config/rabbitmq";
import { logger, logFinancialEvent } from "../config/logger";
import { prisma } from "../config/database";
import { mintFromUsdcInternal } from "../controllers/mintController";
import { fetchXlmRateUsd } from "../services/oracle/cryptoClient";
import { randomUUID } from "crypto";

const QUEUE = QUEUES.XLM_TO_ACBU;

export interface XlmToAcbuPayload {
  onRampSwapId: string;
  userId: string;
  stellarAddress: string;
  xlmAmount: string;
  usdcEquivalent?: string; // optional; if not set, computed from xlmAmount * XLM_USD_RATE
}

export async function startXlmToAcbuConsumer(): Promise<void> {
  const ch = await connectRabbitMQ();
  await ch.assertQueue(QUEUE, { durable: true });
  ch.prefetch(1);
  ch.consume(
    QUEUE,
    async (msg: ConsumeMessage | null) => {
      if (!msg) return;
      try {
        const body = JSON.parse(msg.content.toString()) as XlmToAcbuPayload;
        const correlationId = randomUUID();
        await processXlmToAcbu(body, correlationId);
        ch.ack(msg);
      } catch (e) {
        logger.error("XLM→ACBU job failed", { error: e });
        ch.nack(msg, false, true);
      }
    },
    { noAck: false },
  );
  logger.info("XLM→ACBU consumer started", { queue: QUEUE });
}

/**
 * Process a single on-ramp swap: sell XLM (stub) and mint ACBU to user.
 */
export async function processXlmToAcbu(
  payload: XlmToAcbuPayload,
  correlationId: string = randomUUID(),
): Promise<void> {
  const { onRampSwapId, userId, stellarAddress, xlmAmount, usdcEquivalent } =
    payload;
  const xlmNum = Number(xlmAmount);
  let usdcAmount = usdcEquivalent ? Number(usdcEquivalent) : 0;

  if (!usdcEquivalent) {
    const liveRate = await fetchXlmRateUsd();
    // Fallback to env or historical default if Oracle is down to maintain resilience
    const fallbackRate = Number(process.env.XLM_USD_RATE ?? "0.2");
    const rate = liveRate ?? fallbackRate;
    usdcAmount = xlmNum * rate;
  }

  // Atomically claim the swap: only one worker wins when status=pending_convert.
  // updateMany returns { count: 0 } if another worker already transitioned it.
  const claimed = await prisma.onRampSwap.updateMany({
    where: { id: onRampSwapId, status: "pending_convert" },
    data: { status: "processing" },
  });
  if (claimed.count === 0) {
    logger.warn(
      "OnRampSwap not found, not pending, or already claimed by another worker",
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

  try {
    const { transactionId, acbuAmount } = await mintFromUsdcInternal(
      usdcAmount,
      stellarAddress,
      userId,
    );
    await prisma.onRampSwap.update({
      where: { id: onRampSwapId },
      data: {
        status: "completed",
        transactionId,
        completedAt: new Date(),
      },
    });
    logger.info("XLM→ACBU completed", {
      onRampSwapId,
      userId,
      stellarAddress,
      acbuAmount,
      transactionId,
    });
    logFinancialEvent({
      event: "onramp.completed",
      status: "success",
      transactionId,
      userId,
      accountId: stellarAddress,
      idempotencyKey: onRampSwapId,
      amount: Math.round(xlmNum * 1e7), // XLM in stroops
      currency: "XLM",
      correlationId,
    });
  } catch (e) {
    await prisma.onRampSwap.update({
      where: { id: onRampSwapId },
      data: { status: "failed" },
    });
    logger.error("XLM→ACBU mint failed", { onRampSwapId, error: e });
    logFinancialEvent({
      event: "onramp.failed",
      status: "failed",
      transactionId: onRampSwapId,
      userId,
      accountId: stellarAddress,
      idempotencyKey: onRampSwapId,
      amount: Math.round(xlmNum * 1e7), // XLM in stroops
      currency: "XLM",
      correlationId,
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/**
 * Enqueue an on-ramp swap for processing (call when user has swapped USDC→XLM).
 */
export async function enqueueXlmToAcbu(
  payload: XlmToAcbuPayload,
): Promise<void> {
  const ch = await connectRabbitMQ();
  await ch.assertQueue(QUEUE, { durable: true });
  ch.sendToQueue(QUEUE, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
  });
  logger.info("XLM→ACBU enqueued", { onRampSwapId: payload.onRampSwapId });
}
