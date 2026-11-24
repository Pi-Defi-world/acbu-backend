/**
 * idGenerator.ts
 *
 * Generates UUIDv7 identifiers for use as database primary keys.
 *
 * Why UUIDv7 instead of UUIDv4 (crypto.randomUUID()):
 *   UUIDv4 is purely random. When used as a PK, every INSERT lands at a random
 *   position in the B-tree index, causing frequent page splits and leaving pages
 *   ~50% full on average (index fragmentation). Under write load this degrades
 *   both INSERT throughput and sequential-scan / range-query performance.
 *
 *   UUIDv7 embeds a millisecond-precision Unix timestamp in the most-significant
 *   bits, making new IDs monotonically increasing within the same millisecond.
 *   New rows always append near the end of the index, keeping pages full and
 *   eliminating random page splits — identical insert-locality to BIGSERIAL but
 *   globally unique and without a shared sequence bottleneck.
 *
 * Format (RFC 9562 §5.7):
 *   0                   1                   2                   3
 *   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *  |                           unix_ts_ms [48]                     |
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *  |  unix_ts_ms   |  ver(0111)    |        rand_a [12]            |
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *  | var(10) |                rand_b [62]                          |
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *
 * Monotonicity guard:
 *   If multiple IDs are generated within the same millisecond, the 12-bit
 *   rand_a sub-field is used as a sequence counter (incremented per call).
 *   This ensures strict ordering within a process even at high throughput.
 *   The counter resets when the timestamp advances.
 *
 * Usage:
 *   import { generateId } from '../utils/idGenerator';
 *
 *   const user = await prisma.user.create({ data: { id: generateId(), ... } });
 *
 * NOTE: Use generateCorrelationId() (UUIDv4) for transient trace/correlation IDs
 * that are not stored as indexed primary keys — ordering provides no benefit there.
 */

import { randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// Internal monotonic counter state
// ---------------------------------------------------------------------------

/** Last millisecond timestamp a UUID was generated at. */
let lastMs = 0n;

/**
 * 12-bit monotonic sequence counter, incremented when two UUIDs are generated
 * within the same millisecond. Resets to a random value on each new ms tick
 * to reduce collision probability when multiple processes share the same clock.
 */
let seqCounter = 0n;

/** Maximum value of the 12-bit rand_a counter before it overflows. */
const SEQ_MAX = 0xfffn;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a UUIDv7 string suitable for use as a PostgreSQL primary key.
 *
 * The returned string is lowercase, hyphen-separated standard UUID format:
 *   xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
 *
 * Monotonicity guarantee: within a single Node.js process, IDs are strictly
 * ordered by generation time, even when multiple IDs are created in the same
 * millisecond tick.
 *
 * Thread safety: Node.js is single-threaded; no mutex required.
 */
export function generateId(): string {
  const nowMs = BigInt(Date.now());

  if (nowMs > lastMs) {
    // New millisecond — reset counter to random 12-bit seed to reduce
    // cross-process collision probability.
    lastMs = nowMs;
    seqCounter = BigInt(randomBytes(2).readUInt16BE(0)) & SEQ_MAX;
  } else {
    // Same millisecond — increment counter.
    seqCounter += 1n;

    if (seqCounter > SEQ_MAX) {
      // Counter overflow: spin until the clock advances.
      // This is extremely unlikely (<4096 IDs/ms) but handled correctly.
      while (BigInt(Date.now()) <= lastMs) {
        // Busy-wait; expected loop duration is < 1 ms.
      }
      lastMs = BigInt(Date.now());
      seqCounter = BigInt(randomBytes(2).readUInt16BE(0)) & SEQ_MAX;
    }
  }

  // 10 random bytes for rand_b (62 bits used after variant bits are applied).
  const randB = randomBytes(10);

  // Build a 16-byte buffer.
  // Bytes  0–5 : 48-bit unix_ts_ms (big-endian)
  // Bytes  6–7 : version nibble (0x7) | rand_a (12 bits from seqCounter)
  // Bytes  8–9 : variant bits (10xx xxxx) | first 14 bits of rand_b
  // Bytes 10–15: remaining 48 bits of rand_b
  const buf = Buffer.alloc(16);

  // --- Timestamp (48 bits) ---
  const msHigh = Number((nowMs >> 16n) & 0xffffffffn);
  const msLow = Number(nowMs & 0xffffn);
  buf.writeUInt32BE(msHigh, 0);
  buf.writeUInt16BE(msLow, 4);

  // --- Version + rand_a (16 bits: 0111 xxxx xxxx xxxx) ---
  const versionAndSeq = 0x7000 | Number(seqCounter & 0x0fffn);
  buf.writeUInt16BE(versionAndSeq, 6);

  // --- Variant (2 bits: 10) + rand_b (62 bits) ---
  // Apply RFC 4122 variant bits: set bit 7 (MSB of byte 8), clear bit 6.
  buf[8] = (randB[0]! & 0x3f) | 0x80;
  buf[9] = randB[1]!;
  buf[10] = randB[2]!;
  buf[11] = randB[3]!;
  buf[12] = randB[4]!;
  buf[13] = randB[5]!;
  buf[14] = randB[6]!;
  buf[15] = randB[7]!;

  return formatUuid(buf);
}

/**
 * Generate a UUIDv4 for transient, non-indexed identifiers such as correlation
 * IDs, request trace IDs, or webhook idempotency keys that are never stored as
 * a primary key. UUIDv4's randomness is appropriate here; ordering confers no
 * benefit and avoids leaking timestamp information in external-facing IDs.
 */
export function generateCorrelationId(): string {
  const buf = randomBytes(16);

  // Set version to 4 (bits 4–7 of byte 6).
  buf[6] = (buf[6]! & 0x0f) | 0x40;

  // Set variant to 10xx xxxx (byte 8).
  buf[8] = (buf[8]! & 0x3f) | 0x80;

  return formatUuid(buf);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Format a 16-byte Buffer as a lowercase hyphen-separated UUID string. */
function formatUuid(buf: Buffer): string {
  const hex = buf.toString("hex");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20)
  );
}
