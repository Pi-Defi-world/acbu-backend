import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database";
import { logger } from "../../config/logger";

/**
 * Ledger entry persistence.
 *
 * Ledger entries are stored as rows in the `Transaction` model (the off-chain
 * financial ledger). Bulk ledger writes — backfills, reconciliation runs, and
 * salary/payroll settlement fan-outs — can produce batches of several hundred
 * or thousand entries at once.
 *
 * #401: Prisma's interactive `$transaction(fn)` callback has a default timeout
 * of 5 s. A single transaction that loops over 100+ inserts can exceed that
 * window, at which point Prisma aborts the transaction. Worse, if the deadline
 * fires after some statements have already been flushed, the caller sees a
 * timeout error while a subset of rows may have landed — an inconsistent,
 * "partially committed" view from the application's perspective.
 *
 * Fix:
 *  - Split the input into bounded chunks (`LEDGER_BATCH_SIZE`). Each chunk is
 *    written with a single `createMany`, so it is one atomic statement that
 *    either fully commits or fully rolls back — never partially.
 *  - Wrap each chunk in `$transaction` with an explicit, generous `timeout`
 *    (and `maxWait`) so a legitimately large batch is not killed by the 5 s
 *    default. The timeout stays under Postgres' `statement_timeout`
 *    (DB_STATEMENT_TIMEOUT_MS, default 9 s) so the database remains the final
 *    arbiter and connections are never left `idle in transaction`.
 */

const DEFAULT_LEDGER_BATCH_SIZE = 100;
const DEFAULT_LEDGER_TX_TIMEOUT_MS = 8000;
const DEFAULT_LEDGER_TX_MAX_WAIT_MS = 2000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const LEDGER_BATCH_SIZE = parsePositiveInt(
  process.env.LEDGER_BATCH_SIZE,
  DEFAULT_LEDGER_BATCH_SIZE,
);
const LEDGER_TX_TIMEOUT_MS = parsePositiveInt(
  process.env.LEDGER_TX_TIMEOUT_MS,
  DEFAULT_LEDGER_TX_TIMEOUT_MS,
);
const LEDGER_TX_MAX_WAIT_MS = parsePositiveInt(
  process.env.LEDGER_TX_MAX_WAIT_MS,
  DEFAULT_LEDGER_TX_MAX_WAIT_MS,
);

export type LedgerEntryInput = Prisma.TransactionCreateManyInput;

export interface CreateLedgerEntriesResult {
  /** Total rows inserted across all chunks. */
  inserted: number;
  /** Number of atomic chunk-transactions committed. */
  batches: number;
}

/**
 * Persist a batch of ledger entries.
 *
 * Entries are committed in bounded, individually-atomic chunks so that a large
 * batch never exceeds the transaction timeout and a single chunk can never
 * partially commit. If a chunk fails, that chunk is rolled back in full and the
 * error is propagated to the caller; chunks committed before it remain
 * durable, and `result.inserted`/`batches` reflect what succeeded up to that
 * point (surfaced via the thrown error's context in logs).
 */
export async function createLedgerEntries(
  entries: LedgerEntryInput[],
): Promise<CreateLedgerEntriesResult> {
  if (entries.length === 0) {
    return { inserted: 0, batches: 0 };
  }

  let inserted = 0;
  let batches = 0;

  for (let start = 0; start < entries.length; start += LEDGER_BATCH_SIZE) {
    const chunk = entries.slice(start, start + LEDGER_BATCH_SIZE);

    try {
      const { count } = await prisma.$transaction(
        (tx: Prisma.TransactionClient) => tx.transaction.createMany({ data: chunk }),
        {
          timeout: LEDGER_TX_TIMEOUT_MS,
          maxWait: LEDGER_TX_MAX_WAIT_MS,
        },
      );
      inserted += count;
      batches += 1;
    } catch (error) {
      logger.error("Ledger bulk insert failed", {
        chunkStart: start,
        chunkSize: chunk.length,
        committedSoFar: inserted,
        committedBatches: batches,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  return { inserted, batches };
}
