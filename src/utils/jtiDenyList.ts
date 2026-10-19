/**
 * Cross-instance JTI deny-list for 2FA challenge tokens (#984).
 *
 * The original implementation (#288) kept used JTIs in an in-process `Map`.
 * That only protects a single process: in a multi-instance deployment a stolen
 * challenge token could be replayed against a sibling instance inside its
 * 5-minute window, and a restart wiped the list entirely.
 *
 * The deny-list is now stored in Redis (the repo's shared cache layer) as one
 * key per JTI whose TTL matches the token's remaining lifetime. `consumeJti`
 * uses an atomic `SET NX`, so exactly one instance can claim a given JTI —
 * the "check" and the "claim" are a single round-trip.
 *
 * A small in-process mirror is retained purely as a fallback for when Redis is
 * unreachable: rather than failing open, single-instance protection degrades
 * to the previous behaviour and a warning is logged.
 */
import { redisService } from "../services/cache";
import { logger } from "../config/logger";

const KEY_PREFIX = "jwt:jti:revoked:";

/**
 * Bound the time a verification spends waiting on Redis so a cache outage
 * degrades to the in-process fallback instead of stalling every 2FA request.
 */
const REDIS_TIMEOUT_MS = 1000;

const localDenyList = new Map<string, number>(); // jti -> expiresAt (Unix ms)

function keyFor(jti: string): string {
  return KEY_PREFIX + jti;
}

/** Prune expired entries to prevent unbounded memory growth. */
function pruneExpired(): void {
  const now = Date.now();
  for (const [jti, expiresAt] of localDenyList) {
    if (expiresAt <= now) {
      localDenyList.delete(jti);
    }
  }
}

// Prune every 5 minutes — matches the challenge token lifetime.
const pruneTimer = setInterval(pruneExpired, 5 * 60 * 1000);
pruneTimer.unref();

/** Seconds until `exp` (Unix seconds), clamped to a positive TTL for Redis. */
function ttlSeconds(exp: number): number {
  const remaining = Math.ceil(exp - Date.now() / 1000);
  return remaining > 0 ? remaining : 1;
}

function withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Redis ${label} timed out after ${REDIS_TIMEOUT_MS}ms`));
    }, REDIS_TIMEOUT_MS);

    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Mark a JTI as used until `exp` (Unix seconds).
 *
 * Writes through to Redis so sibling instances reject the same token, and
 * mirrors locally so a Redis outage still blocks replays on this instance.
 */
export async function revokeJti(jti: string, exp: number): Promise<void> {
  localDenyList.set(jti, exp * 1000);
  try {
    await withTimeout(redisService.set(keyFor(jti), "1", ttlSeconds(exp)), "SET");
  } catch (error) {
    logger.warn("JTI deny-list: Redis write failed; using in-process fallback", {
      error: describeError(error),
    });
  }
}

/**
 * Atomically claim a JTI for single use.
 *
 * Returns `true` when this caller won the claim (the JTI is now revoked) and
 * `false` when it had already been used anywhere. The Redis `SET NX` makes the
 * check-and-claim atomic across concurrent instances; if Redis is unavailable
 * the in-process mirror preserves the previous single-instance guarantee.
 */
export async function consumeJti(jti: string, exp: number): Promise<boolean> {
  pruneExpired();
  if (localDenyList.has(jti)) {
    return false;
  }

  try {
    const claimed = await withTimeout(
      redisService.setNx(keyFor(jti), "1", ttlSeconds(exp)),
      "SET NX",
    );
    if (!claimed) {
      return false;
    }
  } catch (error) {
    logger.warn("JTI deny-list: Redis unavailable; using in-process fallback", {
      error: describeError(error),
    });
  }

  localDenyList.set(jti, exp * 1000);
  return true;
}

/**
 * Returns true if the JTI has already been used (is in the shared deny-list).
 * Used when a caller performs its own single-use bookkeeping (`consumeJti: false`).
 */
export async function isJtiRevoked(jti: string): Promise<boolean> {
  pruneExpired();
  if (localDenyList.has(jti)) {
    return true;
  }

  try {
    const value = await withTimeout(redisService.get(keyFor(jti)), "GET");
    return value !== null;
  } catch (error) {
    logger.warn("JTI deny-list: Redis read failed; using in-process fallback", {
      error: describeError(error),
    });
    return false;
  }
}
