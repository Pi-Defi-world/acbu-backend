import { AppError } from "../middleware/errorHandler";

export type TransactionStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

const ALLOWED_TRANSITIONS: Record<TransactionStatus, TransactionStatus[]> = {
  pending: ["processing", "failed"],
  processing: ["completed", "failed"],
  completed: [],
  failed: [],
};

/**
 * Assert that transitioning from `from` to `to` is valid.
 * Throws AppError(409) for illegal transitions to prevent balance corruption.
 */
export function assertValidTransition(
  from: TransactionStatus,
  to: TransactionStatus,
): void {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) {
    throw new AppError(`Unknown source status: ${from}`, 422);
  }
  if (!allowed.includes(to)) {
    throw new AppError(
      `Invalid transaction status transition: ${from} → ${to}`,
      409,
    );
  }
}

/**
 * Returns true when a status is terminal (no further transitions possible).
 */
export function isTerminalStatus(status: TransactionStatus): boolean {
  return ALLOWED_TRANSITIONS[status]?.length === 0;
}
