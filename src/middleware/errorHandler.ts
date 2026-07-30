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
 * Sanitize AppError.details before including it in a client-facing response.
 *
 * Guarantees:
 *  - Only plain JSON-serializable values reach the client (no class instances,
 *    Buffers, functions, Symbols, or circular references).
 *  - Returns undefined if sanitization fails for any reason, so callers can
 *    simply omit the details key rather than crashing or leaking internals.
 */
function sanitizeDetailsForClient(details: unknown): unknown {
  if (details === null || details === undefined) return undefined;
  try {
    // JSON round-trip drops functions/Symbols/undefined values and throws on
    // circular references, guaranteeing a plain, serializable value.
    return JSON.parse(JSON.stringify(details));
  } catch {
    // Circular reference or other non-serializable content — omit entirely.
    return undefined;
  }
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

    const clientDetails = sanitizeDetailsForClient(err.details);
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        error_code: err.code,
        message: err.message,
        statusCode: err.statusCode,
        ...(clientDetails !== undefined ? { details: clientDetails } : {}),
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

