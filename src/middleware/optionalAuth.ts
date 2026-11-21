/**
 * Optional API-key authentication middleware.
 *
 * Behaves like `validateApiKey` but does NOT reject the request when no
 * credential is supplied.  If a credential is present it MUST be valid —
 * an invalid key still results in a 401.  This allows routes to serve a
 * degraded (public-safe) response to unauthenticated callers while
 * returning enriched data to authenticated ones (see W10-BE-013).
 */
import { Response, NextFunction } from "express";
import { validateApiKey, AuthRequest } from "./auth";

export async function optionalApiKey(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const credential =
    req.headers["x-api-key"] ||
    req.headers["authorization"]?.replace("Bearer ", "");

  if (!credential) {
    // No credential supplied — continue without setting req.apiKey
    next();
    return;
  }

  // A credential was supplied — validate it fully (invalid key → 401)
  return validateApiKey(req, res, next);
}
