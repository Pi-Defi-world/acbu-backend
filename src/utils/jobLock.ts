/**
 * Distributed job lock backed by MongoDB (#418).
 *
 * Uses a `findOneAndUpdate` with `$setOnInsert` + a TTL field to implement
 * a single-writer, auto-expiring advisory lock.  The instance that inserts
 * the document wins; others see the existing doc and skip.
 *
 * Usage:
 *   const acquired = await acquireJobLock("oracle-update", 6 * 3600);
 *   if (!acquired) return; // another instance already running
 *   try { await doWork(); } finally { await releaseJobLock("oracle-update"); }
 */
import { getMongoDB } from "../config/mongodb";
import { logger } from "../config/logger";

const COLLECTION = "job_locks";

export async function ensureJobLockIndex(): Promise<void> {
  try {
    const db = getMongoDB();
    await db
      .collection(COLLECTION)
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, background: true });
    await db.collection(COLLECTION).createIndex({ jobName: 1 }, { unique: true, background: true });
  } catch (err) {
    logger.warn("Failed to create job_locks indexes", { err });
  }
}

/**
 * Try to acquire an exclusive lock for `jobName`.
 * Returns true if this instance acquired the lock, false if another instance holds it.
 * The lock expires automatically after `ttlSeconds` even without an explicit release.
 */
export async function acquireJobLock(jobName: string, ttlSeconds: number): Promise<boolean> {
  try {
    const db = getMongoDB();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    // Atomically insert only if no document with this jobName exists yet.
    // $setOnInsert runs only when a new document is created (upsert hits no match).
    const result = await db.collection(COLLECTION).findOneAndUpdate(
      { jobName },
      {
        $setOnInsert: { jobName, acquiredAt: now, expiresAt },
      },
      { upsert: true, returnDocument: "before" },
    );

    // If result is null the document did not exist — we just created it → lock acquired.
    // If result has a value the document already existed → another instance holds the lock.
    return result === null || result === undefined;
  } catch (err: any) {
    // Duplicate key on concurrent upsert — another instance won.
    if (err?.code === 11000) return false;
    logger.warn("acquireJobLock failed; proceeding without lock", { jobName, err });
    // Fail open: if MongoDB is unavailable we don't want to block all jobs.
    return true;
  }
}

/**
 * Release the lock held by this instance.
 */
export async function releaseJobLock(jobName: string): Promise<void> {
  try {
    const db = getMongoDB();
    await db.collection(COLLECTION).deleteOne({ jobName });
  } catch (err) {
    logger.warn("releaseJobLock failed", { jobName, err });
  }
}
