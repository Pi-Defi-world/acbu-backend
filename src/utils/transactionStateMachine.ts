import { AppError } from "../middleware/errorHandler";

/**
 * Every value `transactions.status` may hold. Mirrored by the
 * `chk_transactions_status` CHECK constraint (migration
 * 20260924000000_constrain_transaction_status) — keep both in sync.
 */
export const TRANSACTION_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "refunded",
] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export function isTransactionStatus(value: unknown): value is TransactionStatus {
  return typeof value === "string" && (TRANSACTION_STATUSES as readonly string[]).includes(value);
}

const ALLOWED_TRANSITIONS: Record<TransactionStatus, TransactionStatus[]> = {
  pending: ["processing", "failed"],
  processing: ["completed", "failed"],
  completed: [],
  failed: [],
  // Set by bills refund reconciliation (billsService); terminal.
  refunded: [],
};

/**
 * Assert that transitioning from `from` to `to` is valid.
 * Throws AppError(409) for illegal transitions to prevent balance corruption.
 */
export function assertValidTransition(from: TransactionStatus, to: TransactionStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) {
    throw new AppError(`Unknown source status: ${from}`, 422);
  }
  if (!allowed.includes(to)) {
    throw new AppError(`Invalid transaction status transition: ${from} → ${to}`, 409);
  }
}

/**
 * Returns true when a status is terminal (no further transitions possible).
 */
export function isTerminalStatus(status: TransactionStatus): boolean {
  return ALLOWED_TRANSITIONS[status]?.length === 0;
}
