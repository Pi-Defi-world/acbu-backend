import { z } from 'zod';
import { QUEUES } from '../config/rabbitmq';


const STELLAR_TX_HASH_REGEX = /^[a-f0-9]{64}$/i;

// ===================== SHARED BASE SCHEMAS =====================

export const BaseEventSchema = z.object({
  contractId: z.string(),
  type: z.string(),
  data: z.record(z.unknown()),
  ledger: z.number(),
  timestamp: z.string().datetime(),
});

export type BaseEvent = z.infer<typeof BaseEventSchema>;

// ===================== ESCROW EVENT SCHEMA =====================

export const EscrowEventSchema = BaseEventSchema.extend({
  type: z.enum(["contract_credited", "contract_debited", "contract_effect"]),
  data: z
    .object({
      amount: z.string().optional(),
      account: z.string().optional(),
      recipient: z.string().optional(),
      to: z.string().optional(),
      transaction_hash: z.string().optional(),
      transaction_id: z.string().optional(),
      tx_hash: z.string().optional(),
    })
    .passthrough(),
});

export type EscrowEvent = z.infer<typeof EscrowEventSchema>;

// ===================== LENDING POOL EVENT SCHEMA =====================

export const LendingPoolEventSchema = BaseEventSchema.extend({
  type: z.enum(["contract_credited", "contract_debited", "contract_effect"]),
  data: z
    .object({
      amount: z.string().optional(),
      account: z.string().optional(),
      recipient: z.string().optional(),
      to: z.string().optional(),
      transaction_hash: z.string().optional(),
    })
    .passthrough(),
});

export type LendingPoolEvent = z.infer<typeof LendingPoolEventSchema>;

// ===================== SAVINGS VAULT EVENT SCHEMA =====================

export const SavingsVaultEventSchema = BaseEventSchema.extend({
  type: z.enum(["contract_credited", "contract_debited", "contract_effect"]),
  data: z
    .object({
      amount: z.string().optional(),
      account: z.string().optional(),
      recipient: z.string().optional(),
      to: z.string().optional(),
      transaction_hash: z.string().optional(),
    })
    .passthrough(),
});

export type SavingsVaultEvent = z.infer<typeof SavingsVaultEventSchema>;

// ===================== BURN EVENT SCHEMA =====================

export const BurnEventSchema = z.object({
  transactionId: z.string().optional(),
  txHash: z.string().regex(STELLAR_TX_HASH_REGEX),
});

export type BurnEvent = z.infer<typeof BurnEventSchema>;

// ===================== MINT EVENT SCHEMA =====================

export const MintEventSchema = z.object({
  usdcAmount: z.string().regex(/^\d+(\.\d+)?$/),
  recipient: z.string().min(56).max(56),
  txHash: z.string().regex(STELLAR_TX_HASH_REGEX).optional(),
  transactionId: z.string().optional(),
});

export type MintEvent = z.infer<typeof MintEventSchema>;

// ===================== AUDIT LOG SCHEMA =====================

export const AuditLogSchema = z.object({
  eventType: z.string().min(1),
  entityType: z.string().optional().nullable(),
  entityId: z.string().optional().nullable(),
  action: z.string().min(1),
  oldValue: z.unknown().optional().nullable(),
  newValue: z.unknown().optional().nullable(),
  performedBy: z.string().optional().nullable(),
  actorType: z.string().optional().nullable(),
  keyType: z.string().optional().nullable(),
  organizationId: z.string().optional().nullable(),
  reason: z.string().optional().nullable(),
  timestamp: z.string().datetime().optional(),
});

export type AuditLog = z.infer<typeof AuditLogSchema>;

// ===================== NOTIFICATION SCHEMAS =====================

export const OtpSendSchema = z.object({
  channel: z.enum(["email", "sms"]),
  to: z.string().min(1),
  code: z.string().min(1),
});

export type OtpSend = z.infer<typeof OtpSendSchema>;

// ── Notification sub-type schemas (discriminated by `type`) ─────────────────

export const ReserveAlertNotificationSchema = z.object({
  type: z.literal("reserve_alert"),
  health: z.string().min(1),
  overcollateralizationRatio: z.number(),
});

export type ReserveAlertNotification = z.infer<typeof ReserveAlertNotificationSchema>;

export const WithdrawalStatusNotificationSchema = z.object({
  type: z.literal("withdrawal_status"),
  userId: z.string().nullable(),
  status: z.string().min(1),
  currency: z.string().min(1),
  amount: z.number(),
  channel: z.array(z.string()).default(["email"]),
});

export type WithdrawalStatusNotification = z.infer<typeof WithdrawalStatusNotificationSchema>;

export const InvestmentWithdrawalReadyNotificationSchema = z.object({
  type: z.literal("investment_withdrawal_ready"),
  userId: z.string().nullable().optional(),
  organizationId: z.string().nullable().optional(),
  amountAcbu: z.number(),
});

export type InvestmentWithdrawalReadyNotification = z.infer<
  typeof InvestmentWithdrawalReadyNotificationSchema
>;

/**
 * Discriminated union of all notification payload shapes.
 * Each variant is fully typed — no passthrough() / implicit any.
 */
export const NotificationSchema = z.discriminatedUnion("type", [
  ReserveAlertNotificationSchema,
  WithdrawalStatusNotificationSchema,
  InvestmentWithdrawalReadyNotificationSchema,
]);

export type Notification = z.infer<typeof NotificationSchema>;

// ===================== WEBHOOK SCHEMA =====================

export const WebhookJobSchema = z.object({
  webhookId: z.string().uuid(),
});

export type WebhookJob = z.infer<typeof WebhookJobSchema>;

// ===================== MESSAGE VERSIONING =====================

export const MessageEnvelopeSchema = z.object({
  version: z.literal(1),
  type: z.string().min(1),
  messageId: z.string().uuid(),
  timestamp: z.string().datetime(),
  payload: z.record(z.unknown()),
});

export type MessageEnvelope = z.infer<typeof MessageEnvelopeSchema>;

// ===================== SCHEMA MAP =====================

export const QUEUE_SCHEMAS = {
  [QUEUES.ACBU_ESCROW_EVENTS]: EscrowEventSchema,
  [QUEUES.ACBU_LENDING_POOL_EVENTS]: LendingPoolEventSchema,
  [QUEUES.ACBU_SAVINGS_VAULT_EVENTS]: SavingsVaultEventSchema,
  [QUEUES.AUDIT_LOGS]: AuditLogSchema,
  [QUEUES.OTP_SEND]: OtpSendSchema,
  [QUEUES.NOTIFICATIONS]: NotificationSchema,
  [QUEUES.WEBHOOKS]: WebhookJobSchema,
  [QUEUES.WITHDRAWAL_PROCESSING]: BurnEventSchema,
  [QUEUES.USDC_CONVERSION]: MintEventSchema,
} as const;

export type QueueName = keyof typeof QUEUE_SCHEMAS;
