/**
 * Consumes WITHDRAWAL_PROCESSING queue: after BurnEvent, validate withdrawal and recipient,
 * disburse via fintech, update transaction status, optionally publish user notification.
 */
import type { ConsumeMessage } from "amqplib";
import {
  connectRabbitMQ,
  QUEUES,
  assertQueueWithDLQ,
} from "../config/rabbitmq";
import { logger } from "../config/logger";
import { prisma } from "../config/database";
import { getFintechRouter } from "../services/fintech";
import type { DisburseRecipient } from "../services/fintech/types";

export interface WithdrawalPayload {
  transactionId: string;
  txHash?: string;
}

export async function startWithdrawalProcessingConsumer(): Promise<void> {
  const ch = await connectRabbitMQ();
  const queue = QUEUES.WITHDRAWAL_PROCESSING;
  await assertQueueWithDLQ(queue);
  ch.prefetch(1);
  ch.consume(
    queue,
    async (msg: ConsumeMessage | null) => {
      if (!msg) return;
      try {
        const body = JSON.parse(msg.content.toString()) as WithdrawalPayload;
        const { transactionId, txHash } = body;
        if (!transactionId) {
          ch.ack(msg);
          return;
        }

        const tx = await prisma.transaction.findUnique({
          where: { id: transactionId },
          select: {
            id: true,
            type: true,
            status: true,
            localCurrency: true,
            localAmount: true,
            recipientAccount: true,
            userId: true,
          },
        });

        if (!tx || tx.type !== "burn") {
          logger.warn("Withdrawal job: transaction not found or not burn", {
            transactionId,
          });
          ch.ack(msg);
          return;
        }
        if (tx.status !== "processing" && tx.status !== "pending") {
          logger.debug("Withdrawal job: transaction already finalized", {
            transactionId,
            status: tx.status,
          });
          ch.ack(msg);
          return;
        }

        const currency = tx.localCurrency;
        const amount = tx.localAmount ? Number(tx.localAmount) : 0;
        const recipientJson = tx.recipientAccount as Record<
          string,
          unknown
        > | null;
        if (
          !currency ||
          !Number.isFinite(amount) ||
          amount <= 0 ||
          !recipientJson
        ) {
          await prisma.transaction.update({
            where: { id: transactionId },
            data: { status: "failed" },
          });
          logger.warn("Withdrawal job: missing currency, amount or recipient", {
            transactionId,
          });
          ch.ack(msg);
          return;
        }

        const recipient: DisburseRecipient = {
          accountNumber: String(
            recipientJson.account_number ?? recipientJson.accountNumber ?? "",
          ),
          bankCode: String(
            recipientJson.bank_code ?? recipientJson.bankCode ?? "",
          ),
          accountName: String(
            recipientJson.account_name ?? recipientJson.accountName ?? "",
          ),
        };
        if (!recipient.accountNumber || !recipient.bankCode) {
          await prisma.transaction.update({
            where: { id: transactionId },
            data: { status: "failed" },
          });
          logger.warn("Withdrawal job: invalid recipient", { transactionId });
          ch.ack(msg);
          return;
        }

        try {
          const router = getFintechRouter();
          const provider = router.getProvider(currency);
          const result = await provider.disburseFunds(
            amount,
            currency,
            recipient,
          );
          await prisma.transaction.update({
            where: { id: transactionId },
            data: {
              status: "completed",
              completedAt: new Date(),
              ...(txHash && { blockchainTxHash: txHash }),
            },
          });
          logger.info("Withdrawal processed", {
            transactionId,
            currency,
            amount,
            fintechTxId: result.transactionId,
          });
          // Optional: publish to NOTIFICATIONS for email/SMS (handled by NotificationService when implemented)
          await publishWithdrawalNotification(
            transactionId,
            tx.userId,
            "completed",
            currency,
            amount,
          );
        } catch (err) {
          logger.error("Withdrawal disbursement failed", {
            transactionId,
            error: err,
          });
          await prisma.transaction.update({
            where: { id: transactionId },
            data: { status: "failed" },
          });
          await publishWithdrawalNotification(
            transactionId,
            tx.userId,
            "failed",
            currency,
            amount,
          );
          ch.nack(msg, false, true);
          return;
        }
        ch.ack(msg);
      } catch (e) {
        logger.error("Withdrawal job failed", { error: e });
        ch.nack(msg, false, true);
      }
    },
    { noAck: false },
  );
  logger.info("Withdrawal processing consumer started", { queue });
}

async function publishWithdrawalNotification(
  transactionId: string,
  userId: string | null,
  status: string,
  currency: string,
  amount: number,
): Promise<void> {
  try {
    const ch = await connectRabbitMQ();
    await assertQueueWithDLQ(QUEUES.NOTIFICATIONS);
    ch.sendToQueue(
      QUEUES.NOTIFICATIONS,
      Buffer.from(
        JSON.stringify({
          type: "withdrawal_status",
          transactionId,
          userId,
          status,
          currency,
          amount,
          channel: ["email", "sms"],
        }),
      ),
      { persistent: true },
    );
  } catch (e) {
    logger.warn("Failed to publish withdrawal notification", {
      transactionId,
      error: e,
    });
  }
}

/**
 * Enqueue a withdrawal processing job (call from BurnEvent handler).
 */
export async function enqueueWithdrawalProcessing(
  payload: WithdrawalPayload,
): Promise<void> {
  const ch = await connectRabbitMQ();
  await assertQueueWithDLQ(QUEUES.WITHDRAWAL_PROCESSING);
  ch.sendToQueue(
    QUEUES.WITHDRAWAL_PROCESSING,
    Buffer.from(JSON.stringify(payload)),
    {
      persistent: true,
    },
  );
  logger.info("Withdrawal processing enqueued", {
    transactionId: payload.transactionId,
  });
}
