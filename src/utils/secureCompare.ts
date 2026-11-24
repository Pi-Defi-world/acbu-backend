import crypto from "crypto";

/**
 * Constant-time comparison for secrets (API keys, signatures, cursor MACs).
 *
 * `crypto.timingSafeEqual` only guarantees constant-time behaviour for buffers
 * of equal length and throws when the lengths differ. The usual workaround —
 * `if (a.length !== b.length) return false` before calling it — short-circuits
 * on the *length* of the expected secret, which is itself a timing oracle: an
 * attacker can learn the length of `ADMIN_API_KEY` (or any other expected
 * secret) by timing responses with candidate inputs of increasing length.
 *
 * Hashing both inputs to a fixed-size digest (SHA-256) before the comparison
 * removes both problems:
 *   - every comparison operates on 32-byte buffers, so the work performed is
 *     independent of the inputs' lengths, and
 *   - inputs of different lengths simply hash to different digests and compare
 *     as unequal instead of throwing.
 *
 * The digest is used purely as a fixed-width envelope around the inputs; this
 * is not a password store, so a plain hash (rather than HMAC/password KDF) is
 * appropriate here.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const digestA = crypto.createHash("sha256").update(a, "utf8").digest();
  const digestB = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

/**
 * Constant-time membership check: returns `true` when `provided` equals any of
 * `expected`. Every candidate is compared even after a match is found, so the
 * time taken does not reveal *which* candidate matched (or how many candidates
 * were checked before the match).
 */
export function constantTimeEqualAny(provided: string, expected: readonly string[]): boolean {
  let matched = false;
  for (const candidate of expected) {
    if (constantTimeEqual(provided, candidate)) {
      matched = true;
    }
  }
  return matched;
}
