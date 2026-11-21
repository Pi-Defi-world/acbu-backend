import { Request, Response, NextFunction } from "express";
import { config } from "../config/env";
import { constantTimeEqual } from "../utils/secureCompare";
import { AppError } from "./errorHandler";

export interface AdminRequest extends Request {
  admin?: { id: string };
  adminId?: string;
}

/**
 * Guard for admin-only endpoints (e.g. /health/deep, /health/metrics).
 * Requires the `x-admin-key` header to match one of the configured admin keys
 * in ADMIN_API_KEYS (or ADMIN_API_KEY).
 * If no admin keys are configured, the endpoint is blocked entirely.
 */
export function requireAdminApiKey(req: Request, _res: Response, next: NextFunction): void {
  const configuredKeys = (config as any).adminApiKeys as
    Array<{ id: string; key: string }> | undefined;

  const adminApiKeys =
    configuredKeys && configuredKeys.length > 0
      ? configuredKeys
      : config.adminApiKey
        ? [{ id: "default_admin", key: config.adminApiKey }]
        : [];

  if (adminApiKeys.length === 0) {
    next(new AppError("Admin endpoint not available", 503));
    return;
  }
  const provided = req.headers["x-admin-key"];
  if (!provided || typeof provided !== "string") {
    next(new AppError("Unauthorized", 401));
    return;
  }

  // Compare against every configured key with a constant-time comparison.
  // (W10-BE-006) A plain `!==` — or a `timingSafeEqual` guarded by a length
  // check — leaks information about the expected secret through response
  // timing. `constantTimeEqual` hashes both values to a fixed-size digest
  // first, so neither the key's content nor its length is observable.
  let matchedAdmin: { id: string; key: string } | null = null;

  for (const admin of adminApiKeys) {
    if (constantTimeEqual(provided, admin.key) && matchedAdmin === null) {
      matchedAdmin = admin;
    }
  }

  if (!matchedAdmin) {
    next(new AppError("Unauthorized", 401));
    return;
  }

  (req as AdminRequest).admin = { id: matchedAdmin.id };
  (req as AdminRequest).adminId = matchedAdmin.id;

  next();
}
