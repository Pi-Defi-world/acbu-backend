import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { config } from "../config/env";
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
  const configuredKeys = (config as any).adminApiKeys as Array<{ id: string; key: string }> | undefined;

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

  const providedBuf = Buffer.from(provided, "utf8");
  let matchedAdmin: { id: string; key: string } | null = null;

  for (const admin of adminApiKeys) {
    const expectedBuf = Buffer.from(admin.key, "utf8");
    if (providedBuf.length === expectedBuf.length) {
      try {
        if (crypto.timingSafeEqual(providedBuf, expectedBuf)) {
          matchedAdmin = admin;
          break;
        }
      } catch {
        // continue checking next key
      }
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
