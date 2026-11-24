import { Operation } from "@stellar/stellar-sdk";
import { logger } from "../../config/logger";

/**
 * Operations that are explicitly forbidden for the treasury account
 * to prevent catastrophic attacks like account_merge that could drain assets
 */
const FORBIDDEN_TREASURY_OPERATIONS = [
  "accountMerge", // Prevents merging treasury into attacker's account
];

/**
 * Allow-list of operation types a treasury transaction may contain
 * (Pi-Defi-world/acbu-backend#983). Anything not on this list — e.g.
 * manageData, setTrustLineFlags, clawback, inflation, bumpFootprintExpiry —
 * is rejected instead of passing the guard unchecked.
 */
const ALLOWED_TREASURY_OPERATIONS = new Set<string>([
  "payment",
  "createAccount",
  "pathPaymentStrictReceive",
  "pathPaymentStrictSend",
  "changeTrust",
  "setOptions",
  "bumpSequence",
]);

/**
 * Operation types that carry a `destination` account. Their destination is
 * validated against the treasury destination allow-list.
 */
const DESTINATION_OPERATION_TYPES = new Set<string>([
  "payment",
  "createAccount",
  "pathPaymentStrictReceive",
  "pathPaymentStrictSend",
]);

/**
 * Destination allow-list for treasury operations (Pi-Defi-world/
 * acbu-backend#983). Comma-separated Stellar account IDs from
 * TREASURY_ALLOWED_DESTINATIONS. Payments to the treasury account itself
 * are always permitted (consolidation moves). When the variable is unset,
 * destination validation is not enforced (back-compat) and only the
 * operation-type allow-list above applies.
 */
export function getTreasuryAllowedDestinations(): string[] {
  const raw = process.env.TREASURY_ALLOWED_DESTINATIONS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function extractDestination(operation: Operation): string | null {
  const dest = (operation as { destination?: unknown }).destination;
  return typeof dest === "string" ? dest : null;
}

/**
 * Validate that a transaction contains only allow-listed operation types and
 * only approved destinations when executed from the treasury account.
 * @param operations - Array of Stellar operations
 * @param accountId - The account ID executing the operations
 * @param treasuryAccountId - The platform's treasury account ID
 * @throws Error if a forbidden operation or non-approved destination is detected
 */
export function validateOperationsForTreasuryAccount(
  operations: Operation[],
  accountId: string,
  treasuryAccountId: string,
): void {
  if (accountId !== treasuryAccountId) {
    return;
  }

  const allowedDestinations = getTreasuryAllowedDestinations();

  for (const operation of operations) {
    const opType = (operation as any).type;

    if (FORBIDDEN_TREASURY_OPERATIONS.includes(opType)) {
      const error = new Error(
        `Operation '${opType}' is forbidden for the treasury account to prevent asset drainage attacks`,
      );
      logger.error("Forbidden treasury operation attempted", {
        operation: opType,
        accountId,
        treasuryAccountId,
      });
      throw error;
    }

    // Operation-type allow-list (Pi-Defi-world/acbu-backend#983).
    if (!ALLOWED_TREASURY_OPERATIONS.has(opType)) {
      const error = new Error(
        `Operation '${opType}' is not allowed for the treasury account: only allow-listed operation types may be executed`,
      );
      logger.error("Disallowed treasury operation type attempted", {
        operation: opType,
        accountId,
        treasuryAccountId,
      });
      throw error;
    }

    // Destination allow-list (Pi-Defi-world/acbu-backend#983): payment-style
    // operations must target the treasury itself or an approved destination.
    const destination = extractDestination(operation);
    if (destination && DESTINATION_OPERATION_TYPES.has(opType)) {
      const isSelf = destination === treasuryAccountId;
      const isApproved = allowedDestinations.includes(destination);
      if (!isSelf && allowedDestinations.length > 0 && !isApproved) {
        const error = new Error(
          `Treasury operation destination '${destination}' is not on the approved destination allow-list`,
        );
        logger.error("Unapproved treasury destination attempted", {
          operation: opType,
          destination,
          accountId,
          treasuryAccountId,
        });
        throw error;
      }
    }
  }
}

/**
 * Check if an account is the treasury account
 */
export function isTreasuryAccount(accountId: string, treasuryAccountId: string): boolean {
  return accountId === treasuryAccountId;
}
