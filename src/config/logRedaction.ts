import winston from "winston";

const CARD_NUMBER_PATTERN = /\b\d{13,19}\b/g;

const SENSITIVE_KEY_PATTERN =
  /pass(?:word|code|wd)|secret|token|authorization|api[_-]?key|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret[_-]?key|secret[_-]?access[_-]?key|\bpin\b|cvv|cvc|ssn|bvn|credit[_-]?card|card[_-]?number|cookie|mnemonic|\bseed\b|\bjwt\b/i;

const REDACTED = "[REDACTED]";

export function redactPii(value: string): string {
  return value.replace(CARD_NUMBER_PATTERN, REDACTED);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Winston structured fields that must never be redacted.
 * - level:     log level string (e.g. "info") — not user data
 * - timestamp: added by winston.format.timestamp() — not user data
 * - message:   the human-readable log message — redacting it would destroy
 *              log readability; sensitive data in messages should use meta
 */
const STRUCTURED_FIELDS = new Set(["level", "timestamp", "message"]);

/**
 * Redact PII from an Error stack trace string.
 * Stack frames may contain file paths or serialised arguments that include
 * card numbers or other PII patterns captured by redactPii().
 */
function redactStack(stack: string): string {
  return redactPii(stack);
}

/** Recursively redact sensitive keys and card-like numbers from log values. */
export function redactLogValue(
  value: unknown,
  key?: string,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (key !== undefined && isSensitiveKey(key)) {
    return REDACTED;
  }
  // Redact PII embedded in stack traces (e.g. serialised card numbers in frames)
  if (key === "stack" && typeof value === "string") {
    return redactStack(value);
  }
  if (typeof value === "string") {
    return redactPii(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item, undefined, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    result[childKey] = redactLogValue(childValue, childKey, seen);
  }
  return result;
}

/** Winston format: apply PII/secret redaction to every log info object. */
export const redactFormat = winston.format((info) => {
  const seen = new WeakSet<object>();
  for (const key of Object.keys(info)) {
    // Skip Winston structured fields — they are not user-supplied data and
    // redacting them would corrupt log readability or Winston's own metadata.
    if (STRUCTURED_FIELDS.has(key)) continue;
    (info as Record<string, unknown>)[key] = redactLogValue(
      (info as Record<string, unknown>)[key],
      key,
      seen,
    );
  }
  return info;
});
