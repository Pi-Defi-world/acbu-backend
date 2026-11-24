/**
 * Idempotency store backed by MongoDB with a configurable TTL.
 *
 * On first call  → atomically claims the key (returns null); caller should
 *                  proceed and then call `resolveIdempotencyKey` when done.
 * On repeat call → returns the previously stored result.
 * After TTL      → MongoDB automatically deletes the document via a TTL index
 *                  (create the index once with `ensureIdempotencyIndex()`).
 *
 * Design notes
 * ────────────
 * - `acquireIdempotencyKey` uses a single `findOneAndUpdate` with `$setOnInsert`
 *   so the "check-and-claim" is one atomic round-trip. There is no separate read
 *   followed by a write; a concurrent caller that races this one will either find
 *   the placeholder already inserted (and wait / return the cached result once
 *   resolved) or lose the upsert and see the existing document.
 *
 * - Errors are NOT swallowed.  The previous implementation caught all exceptions
 *   and returned `null`, which the caller interpreted as "first request — proceed".
 *   That silent failure allowed double-processing if MongoDB was momentarily
 *   unavailable.  Both `acquireIdempotencyKey` and `resolveIdempotencyKey` now
 *   let errors propagate so callers can handle them explicitly (e.g. abort the
 *   request with a 503 rather than executing a money-moving operation twice).
 *
 * - `ensureIdempotencyIndex` retains warn-and-continue behaviour because it runs
 *   at startup; a transient index-creation failure must not crash the server.
 */
import { getMongoDB } from "../../config/mongodb";
import { logger } from "../../config/logger";

const COLLECTION = "idempotency_keys";
const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export interface IdempotencyRecord<T = unknown> {
  key: string;
  /** "pending" while the first request is still in-flight; "resolved" once done. */
  status: "pending" | "resolved";
  result?: T;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Ensure the TTL index exists. Call once at startup (idempotent).
 * Failures are logged as warnings; they must not block server start.
 */
export async function ensureIdempotencyIndex(): Promise<void> {
  try {
    const db = getMongoDB();
    await db
      .collection(COLLECTION)
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, background: true });
    await db.collection(COLLECTION).createIndex({ key: 1 }, { unique: true, background: true });
  } catch (err) {
    logger.warn("Failed to create idempotency indexes", { err });
  }
}

/**
 * Atomically attempt to acquire an idempotency key.
 *
 * Returns `null` when this is the first request for `key` (the caller should
 * proceed with the operation and call `resolveIdempotencyKey` afterwards).
 *
 * Returns the previously stored result when the key was already resolved by an
 * earlier request.
 *
 * If the key exists but is still "pending" (a concurrent in-flight request
 * claimed it first), returns `null` so the caller can decide how to handle the
 * race — typically by returning a 409 or retrying after a short delay.
 *
 * Throws if the MongoDB datastore is unavailable.  Callers must NOT treat
 * datastore errors as a green light to proceed; doing so risks double-processing
 * on money-moving paths.
 */
export async function acquireIdempotencyKey<T>(
  key: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<T | null> {
  const db = getMongoDB();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  // Single atomic operation: insert a "pending" placeholder only if the key does
  // not yet exist.  `returnDocument: "before"` gives us the document that was
  // present *before* the update:
  //   • null  → we inserted the placeholder; this is the first request.
  //   • doc   → the key already existed; inspect its status.
  const before = await db
    .collection<IdempotencyRecord<T>>(COLLECTION)
    .findOneAndUpdate(
      { key },
      { $setOnInsert: { key, status: "pending" as const, createdAt: now, expiresAt } },
      { upsert: true, returnDocument: "before" },
    );

  if (before === null) {
    // Successfully claimed the key — this is the first request.
    return null;
  }

  if (before.status === "resolved" && "result" in before) {
    // A previous request already completed; return the cached result.
    return before.result as T;
  }

  // Status is "pending" — a concurrent request claimed the key but hasn't
  // finished yet.  Return null; the caller should treat this as "proceed with
  // caution" or surface a 409 to the client.
  return null;
}

/**
 * Store the result for a previously acquired idempotency key.
 *
 * Marks the document as "resolved" so future calls to `acquireIdempotencyKey`
 * return the cached result instead of null.
 *
 * Throws if the datastore write fails.  Callers should log the failure but
 * must not silently discard it; a missing resolve means the next retry will
 * re-execute the operation rather than returning the cached result.
 */
export async function resolveIdempotencyKey<T>(
  key: string,
  result: T,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<void> {
  const db = getMongoDB();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  await db.collection<IdempotencyRecord<T>>(COLLECTION).updateOne(
    { key },
    {
      $set: { status: "resolved" as const, result, expiresAt },
      $setOnInsert: { key, createdAt: now },
    },
    { upsert: true },
  );
}
