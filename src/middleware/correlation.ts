import crypto from "crypto";
import { Request, Response, NextFunction } from "express";

/**
 * Correlation ID middleware.
 *
 * Reads `X-Correlation-ID` from the incoming request (falling back to
 * `X-Request-ID` for clients that use the older header name). When neither
 * is present, a new UUIDv4 is generated so every request is traceable
 * through the full microservice chain.
 *
 * The resolved ID is:
 *  - attached to `req.correlationId` for downstream handlers
 *  - echoed back in the `X-Correlation-ID` response header so callers can
 *    correlate their own logs with server-side traces
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id =
    (req.headers["x-correlation-id"] as string | undefined) ||
    (req.headers["x-request-id"] as string | undefined) ||
    crypto.randomUUID();

  req.correlationId = id;
  res.setHeader("X-Correlation-ID", id);

  next();
}
