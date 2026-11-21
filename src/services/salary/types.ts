/**
 * Represents a single entry in the salary schedule's amountConfig JSONB field.
 * Each entry defines one recipient and the amount they should receive.
 */
export interface AmountConfigItem {
  /** Amount to disburse (stored as a numeric string or number). */
  amount: string | number;
  /** Internal user/recipient identifier (optional, for record-keeping). */
  recipient_id?: string;
  /** On-chain or wallet address to send funds to. */
  recipient_address: string;
}

/**
 * The structured type for the `amountConfig` JSONB column on SalarySchedule.
 * At runtime Prisma returns this as `Prisma.JsonValue`; cast via `parseAmountConfig`
 * to get full type safety.
 */
export type AmountConfig = AmountConfigItem[];

export interface CreateSalaryBatchParams {
  organizationId?: string;
  userId: string;
  totalAmount?: string;
  currency: string;
  idempotencyKey?: string;
  items: Array<{
    recipientId?: string;
    recipientAddress: string;
    amount: string;
  }>;
}

export interface CreateSalaryBatchResult {
  batchId: string;
  status: string;
}

export interface SalaryBatchDetails {
  id: string;
  status: string;
  totalAmount: string;
  currency: string;
  createdAt: string;
  items: Array<{
    id: string;
    recipientAddress: string;
    amount: string;
    status: string;
    transactionId?: string;
    errorMessage?: string;
  }>;
}
