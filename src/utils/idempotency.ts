import { AppError } from "../middleware/errorHandler";

const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

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
