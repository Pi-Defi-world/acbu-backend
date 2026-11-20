import { AppError } from "../middleware/errorHandler";

export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

/**
 * Scope an idempotency key to a specific user to prevent cross-user collisions.
 * A partner `fintech_tx_id` is globally unique within a partner, but two users
 * submitting the same `fintech_tx_id` would collide on a globally-unique column.
 * Scoping to the user removes that attack surface (#985).
 *
 * The result is truncated to IDEMPOTENCY_KEY_MAX_LENGTH characters by hashing
 * the overflow — the prefix `<userId>:<rawKey>` is preserved when it fits.
 */
export function scopeIdempotencyKey(userId: string, rawKey: string): string {
  const scoped = `${userId}:${rawKey}`;
  if (scoped.length <= IDEMPOTENCY_KEY_MAX_LENGTH) {
    return scoped;
  }
  // Truncate deterministically: keep the user prefix + first 32 chars of key hash
  const crypto = require("crypto") as typeof import("crypto");
  const hash = crypto.createHash("sha256").update(rawKey).digest("hex").slice(0, 32);
  const prefix = `${userId}:`;
  const maxKeyLen = IDEMPOTENCY_KEY_MAX_LENGTH - prefix.length - 1;
  return `${prefix}${hash.slice(0, Math.max(maxKeyLen, 32))}`;
}

export function extractIdempotencyKey(req: {
  get?(name: string): string | undefined;
  headers?: Record<string, string | string[] | undefined>;
}): string | undefined {
  const rawKey =
    typeof req.get === "function"
      ? req.get("Idempotency-Key")
      : (req.headers?.["Idempotency-Key"] ?? req.headers?.["idempotency-key"]);
  if (rawKey === undefined) {
    return undefined;
  }

  const normalizedKey = (Array.isArray(rawKey) ? rawKey[0] : rawKey).trim();
  if (normalizedKey.length === 0) {
    throw new AppError(
      "Idempotency-Key header must be a non-empty string",
      400,
      "VALIDATION_ERROR",
    );
  }

  if (normalizedKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new AppError(
      `Idempotency-Key header exceeds maximum length of ${IDEMPOTENCY_KEY_MAX_LENGTH}`,
      400,
      "VALIDATION_ERROR",
    );
  }

  return normalizedKey;
}
