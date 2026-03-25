import { Request, Response, NextFunction } from "express";
import { logger } from "../config/logger";

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
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

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof AppError) {
    logger.error("Application error", {
      message: err.message,
      statusCode: err.statusCode,
      path: req.path,
      method: req.method,
    });

    res.status(err.statusCode).json({
      error: {
        message: err.message,
        statusCode: err.statusCode,
      },
    });
    return;
  }

  // Unexpected errors: log sanitized details, never expose internals to client
  logger.error("Unexpected error", sanitizeForLog(err, req));

  res.status(500).json({
    error: {
      message: "Internal server error",
      statusCode: 500,
    },
  });
};
