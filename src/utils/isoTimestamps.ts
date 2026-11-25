/**
 * ISO 8601 timestamp normalisation for API responses (W11-AUD-022).
 *
 * Some controllers returned timestamps as UNIX epoch milliseconds while others
 * returned ISO 8601 strings, which broke frontend date parsing. Every response
 * body is passed through `normalizeTimestamps` before serialisation so that all
 * timestamp fields are emitted as ISO 8601 UTC strings
 * (e.g. "2026-11-20T12:00:00.000Z").
 */

/**
 * Keys treated as timestamps: `timestamp`, `date`, `time`, and anything ending
 * in `At` / `_at` / `Timestamp` / `_timestamp` / `Date` / `_date`
 * (createdAt, updated_at, lastSyncTimestamp, settlementDate, ...).
 */
const TIMESTAMP_KEY_PATTERN = /^(timestamp|date|time)$|(At|_at|Timestamp|_timestamp|Date|_date)$/;

/**
 * Epoch-millisecond window accepted for conversion: 2001-09-09 .. 2286-11-20.
 * Numbers outside this window (counts, durations, epoch seconds, sentinel 0)
 * are left untouched so non-timestamp numerics are never corrupted.
 */
const MIN_EPOCH_MS = 1_000_000_000_000;
const MAX_EPOCH_MS = 9_999_999_999_999;

export function isTimestampKey(key: string): boolean {
  return TIMESTAMP_KEY_PATTERN.test(key);
}

function isEpochMillis(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_EPOCH_MS && value <= MAX_EPOCH_MS;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively convert timestamp values to ISO 8601 UTC strings.
 * - `Date` instances anywhere in the payload → `toISOString()` (invalid → null)
 * - epoch-millisecond numbers under timestamp-like keys → `toISOString()`
 * Returns a new structure; the input is never mutated.
 */
export function normalizeTimestamps(
  value: unknown,
  key?: string,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "number") {
    return key !== undefined && isTimestampKey(key) && isEpochMillis(value)
      ? new Date(value).toISOString()
      : value;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    // Leave circular structures for JSON.stringify to report as before.
    return value;
  }

  if (Array.isArray(value)) {
    seen.add(value);
    const out = value.map((item) => normalizeTimestamps(item, undefined, seen));
    seen.delete(value);
    return out;
  }

  // Only walk plain objects; class instances (Decimal, Buffer, ...) keep their
  // own toJSON() behaviour.
  if (!isPlainObject(value)) {
    return value;
  }

  seen.add(value);
  const out: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = normalizeTimestamps(childValue, childKey, seen);
  }
  seen.delete(value);
  return out;
}
