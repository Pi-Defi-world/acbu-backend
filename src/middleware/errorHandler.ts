import { Request, Response, NextFunction } from "express";
import { logger } from "../config/logger";
import { ErrorCodes } from "../types/errorCodes";

export class AppError extends Error {
  statusCode: number;
  code: string;
  isOperational: boolean;
  details?: unknown;

  constructor(
    message: string,
    statusCode: number,
    codeOrDetails?: string | unknown,
    details?: unknown,
  ) {
    super(message);
    this.statusCode = statusCode;
    const fallbackCode =
      statusCode === 429
        ? ErrorCodes.RATE_LIMIT_EXCEEDED
        : statusCode >= 500
          ? ErrorCodes.INTERNAL_ERROR
          : ErrorCodes.BAD_REQUEST;

    this.code =
      typeof codeOrDetails === "string"
        ? codeOrDetails
        : fallbackCode;
    this.details =
      typeof codeOrDetails === "string" ? details : codeOrDetails;
    this.isOperational = true;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Sanitize an error for logging: strip stack traces in production
 * and ensure no PII or secrets leak into log output.
 */
function sanitizeForLog(err: Error, req: Request) {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    message: err.message,
    name: err.name,
    path: req.path,
    method: req.method,
    ...(isProduction ? {} : { stack: err.stack }),
  };
}

function summarizeErrorDetails(details: unknown): unknown {
  if (!details) return undefined;
  if (typeof details === "string") return "REDACTED_STRING_DETAILS";
  if (Array.isArray(details)) return { type: "array", count: details.length };
  if (typeof details === "object") {
    return {
      type: "object",
      keys: Object.keys(details as Record<string, unknown>).slice(0, 10),
    };
  }
  return "REDACTED_NON_OBJECT_DETAILS";
}

/**
 * Keys whose primitive values are safe to return to API clients as-is.
 * These carry field-level validation errors and small, structured metadata.
 */
const SAFE_DETAIL_SCALAR_KEYS = new Set([
  "message",
  "path",
  "field",
  "code",
  "reason",
]);

/**
 * Known-safe containers emitted by the validation middleware. Their inner
 * keys (e.g. Zod field paths) are dynamic, so they are not allowlisted by
 * name, but their values must still resolve to primitives.
 */
const SAFE_DETAIL_CONTAINER_KEYS = new Set([
  "errors",
  "formErrors",
  "fieldErrors",
]);

const REDACTED_DETAILS = "REDACTED_DETAILS";
const MAX_DETAIL_KEYS = 10;
const MAX_DETAIL_DEPTH = 3;

function isPrimitiveDetail(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/**
 * Replace an object with a shape summary that exposes its keys but none of
 * its values. Mirrors `summarizeErrorDetails` so redacted details stay
 * observable without leaking internal state.
 */
function redactDetailObject(value: object): { type: "object"; keys: string[] } {
  return {
    type: "object",
    keys: Object.keys(value).slice(0, MAX_DETAIL_KEYS),
  };
}

/**
 * Sanitize a single value nested inside `details`.
 */
function sanitizeDetailValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return undefined;
  if (isPrimitiveDetail(value)) return value;
  if (depth >= MAX_DETAIL_DEPTH) {
    return typeof value === "object"
      ? redactDetailObject(value)
      : REDACTED_DETAILS;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeDetailValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    // Nested field descriptions such as { path, message } are safe when every
    // key is allowlisted and every value is a primitive.
    if (
      keys.length > 0 &&
      keys.every(
        (key) =>
          SAFE_DETAIL_SCALAR_KEYS.has(key) && isPrimitiveDetail(record[key]),
      )
    ) {
      return keys.reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = record[key];
        return acc;
      }, {});
    }
    return redactDetailObject(record);
  }
  return REDACTED_DETAILS;
}

/**
 * Sanitize Zod `flatten()` fieldErrors: `{ [field]: string[] }`.
 * Field names are preserved; nested objects under a field are dropped.
 */
function sanitizeFieldErrors(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [field, messages] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (Array.isArray(messages)) {
      out[field] = messages.filter(isPrimitiveDetail);
    } else if (isPrimitiveDetail(messages)) {
      out[field] = messages;
    }
  }
  return out;
}

/**
 * Sanitize `AppError.details` before it is serialized to an API client.
 *
 * Policy:
 * - Primitives (string | number | boolean) are returned as-is.
 * - Arrays keep their primitive entries and recursively sanitized objects;
 *   `undefined` entries are dropped.
 * - Flat objects are only kept when every key is in `SAFE_DETAIL_SCALAR_KEYS`
 *   and every value is a primitive (e.g. `{ path, message }`).
 * - Validation containers (`errors`, `formErrors`, `fieldErrors`) keep their
 *   expected client-facing shape, but values deeper than a single level are
 *   dropped or redacted.
 * - Anything else — stack traces, tokens, internal SDK/DB objects, unknown
 *   keys — is replaced with a `{ type: "object", keys: [...] }` summary.
 */
function sanitizeErrorDetails(details: unknown): unknown {
  if (details === null || details === undefined) return undefined;
  if (isPrimitiveDetail(details)) return details;
  if (Array.isArray(details)) {
    return details
      .map((item) => sanitizeDetailValue(item, 1))
      .filter((item) => item !== undefined);
  }
  if (typeof details !== "object") return REDACTED_DETAILS;

  const record = details as Record<string, unknown>;
  const keys = Object.keys(record);

  const isSafeContainer =
    keys.length > 0 && keys.every((key) => SAFE_DETAIL_CONTAINER_KEYS.has(key));

  if (isSafeContainer) {
    const sanitized: Record<string, unknown> = {};
    for (const key of keys) {
      const value = record[key];
      if (key === "formErrors") {
        sanitized[key] = Array.isArray(value)
          ? value.filter(isPrimitiveDetail)
          : [];
      } else if (key === "fieldErrors") {
        sanitized[key] = sanitizeFieldErrors(value);
      } else {
        // `errors`: an array of `{ path, message }` entries or primitives.
        sanitized[key] = Array.isArray(value)
          ? value
              .map((item) => sanitizeDetailValue(item, 1))
              .filter((item) => item !== undefined)
          : sanitizeDetailValue(value, 1);
      }
    }
    return sanitized;
  }

  // Flat, known-safe scalar objects (e.g. the JSON parse error detail).
  if (keys.length > 0) {
    const allSafeScalars = keys.every(
      (key) =>
        SAFE_DETAIL_SCALAR_KEYS.has(key) && isPrimitiveDetail(record[key]),
    );
    if (allSafeScalars) {
      return keys.reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = record[key];
        return acc;
      }, {});
    }
  }

  return redactDetailObject(record);
}

export const errorHandler = (
  err: Error | AppError | SyntaxError,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof SyntaxError && "body" in err) {
    logger.warn("JSON Parse Error", { message: err.message, path: req.path });
    res.status(400).json({
      error: {
        code: "INVALID_JSON",
        error_code: "INVALID_JSON",
        message: "Invalid JSON payload",
        details: { message: err.message },
      },
    });
    return;
  }

  if (err instanceof AppError) {
    logger.error("Application error", {
      message: err.message,
      statusCode: err.statusCode,
      code: err.code,
      path: req.path,
      method: req.method,
      details: summarizeErrorDetails(err.details),
    });

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        error_code: err.code,
        message: err.message,
        statusCode: err.statusCode,
        // Never send raw `err.details` to clients: sanitize first so stack
        // traces, tokens and other internal state cannot leak.
        ...(err.details
          ? { details: sanitizeErrorDetails(err.details) }
          : {}),
      },
    });
    return;
  }

  // Unexpected errors: log sanitized details, never expose internals to client
  logger.error("Unexpected error", sanitizeForLog(err, req));

  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      error_code: "INTERNAL_ERROR",
      message: "Internal server error",
    },
  });
};
