/**
 * Consumes WALLET_ACTIVATION queue: when user pays KYC fee, send min crypto to their address.
 *
 * Chain Selection:
 * - Uses Pi when PI_BRIDGE_ENABLED=true
 * - Falls back to Stellar XLM otherwise
 */
import type { ConsumeMessage } from "amqplib";
import { connectRabbitMQ, QUEUES } from "../config/rabbitmq";
import { logger } from "../config/logger";
import { sendCryptoToActivate } from "../services/wallet/walletActivationService";

const QUEUE = QUEUES.WALLET_ACTIVATION;

export async function startWalletActivationConsumer(): Promise<void> {
  const ch = await connectRabbitMQ();
  await ch.assertQueue(QUEUE, { durable: true });
  ch.prefetch(1);
  ch.consume(
    QUEUE,
    async (msg: ConsumeMessage | null) => {
      if (!msg) return;
      try {
        const body = JSON.parse(msg.content.toString()) as {
          userId: string;
          stellarAddress: string;
        };
        await sendCryptoToActivate(body.stellarAddress);
        ch.ack(msg);
      } catch (e) {
        logger.error("Wallet activation job failed", { error: e });
        ch.nack(msg, false, true);
      }
    },
    { noAck: false },
  );
  logger.info("Wallet activation consumer started", { queue: QUEUE });
}
