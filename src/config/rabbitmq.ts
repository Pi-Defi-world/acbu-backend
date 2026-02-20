import amqp, { Channel, ChannelModel } from 'amqplib';
import { config } from './env';
import { logger } from './logger';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

export async function connectRabbitMQ(): Promise<Channel> {
  if (channel) {
    return channel;
  }

  try {
    connection = await amqp.connect(config.rabbitmqUrl);
    const ch = await connection.createChannel();
    channel = ch;
    logger.info('RabbitMQ connected successfully');

    // Handle connection errors
    connection.on('error', (err: Error) => {
      logger.error('RabbitMQ connection error', err);
    });

    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed');
      connection = null;
      channel = null;
    });

    return ch;
  } catch (error) {
    logger.error('Failed to connect to RabbitMQ', error);
    throw error;
  }
}

export async function disconnectRabbitMQ(): Promise<void> {
  if (channel) {
    await channel.close();
    channel = null;
  }
  if (connection) {
    await connection.close();
    connection = null;
    logger.info('RabbitMQ disconnected');
  }
}

export function getRabbitMQChannel(): Channel {
  if (!channel) {
    throw new Error('RabbitMQ not connected. Call connectRabbitMQ() first.');
  }
  return channel;
}

// Queue names
export const QUEUES = {
  USDC_CONVERSION: 'usdc_conversion',
  WITHDRAWAL_PROCESSING: 'withdrawal_processing',
  REBALANCING: 'rebalancing',
  NOTIFICATIONS: 'notifications',
  OTP_SEND: 'otp_send', // OTP delivery (email/SMS) via worker
  WEBHOOKS: 'webhooks',
  KYC_PROCESSING: 'kyc_processing',
  WALLET_ACTIVATION: 'wallet_activation', // send XLM to user wallet when KYC fee paid
  ACBU_SAVINGS_VAULT_EVENTS: 'acbu_savings_vault_events',
  ACBU_LENDING_POOL_EVENTS: 'acbu_lending_pool_events',
  ACBU_ESCROW_EVENTS: 'acbu_escrow_events',
  XLM_TO_ACBU: 'xlm_to_acbu', // XLM deposit: sell XLM and mint ACBU to user
  USDC_CONVERT_AND_MINT: 'usdc_convert_and_mint', // USDC deposit: convert USDC→XLM (backend), then mint
} as const;

// Exchange names
export const EXCHANGES = {
  RESERVE_EVENTS: 'reserve_events',
  TRANSACTION_EVENTS: 'transaction_events',
} as const;
