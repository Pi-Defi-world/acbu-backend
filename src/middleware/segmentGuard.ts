import { Response, NextFunction } from "express";
import { AppError } from "./errorHandler";
import type { AuthRequest, UserTier } from "./auth";

/**
 * Segment scopes: p2p, sme, international, salary, enterprise, savings, lending, bills, gateway, payroll.
 * Each segment can have :read and :write (e.g. p2p:read, p2p:write).
 */
export const SEGMENT_SCOPES = [
  "p2p:read",
  "p2p:write",
  "sme:read",
  "sme:write",
  "international:read",
  "international:write",
  "salary:read",
  "salary:write",
  "enterprise:read",
  "enterprise:write",
  "savings:read",
  "savings:write",
  "lending:read",
  "lending:write",
  "bills:read",
  "bills:write",
  "gateway:read",
  "gateway:write",
  "payroll:read",
  "payroll:write",
  "government:read",
  "government:write",
  "investment:read",
  "investment:write",
] as const;

export type SegmentScope = (typeof SEGMENT_SCOPES)[number];

/**
 * Require at least one of the given segment scopes on the API key.
 * Use after validateApiKey. Denies with 403 if key lacks the scope.
 */
export function requireSegmentScope(...scopes: SegmentScope[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction): void => {
    if (!req.apiKey) {
      next(new AppError("API key required", 401));
      return;
    }
    const permissions = req.apiKey.permissions || [];
    const hasScope = scopes.some((scope) => permissions.includes(scope));
    if (!hasScope) {
      next(
        new AppError(
          `Missing segment scope. Required one of: ${scopes.join(", ")}`,
          403,
        ),
      );
      return;
    }
    next();
  };
}

/**
 * Require a minimum tier (free < verified < sme < enterprise).
 * Use after validateApiKey when user is loaded. Denies with 403 if tier is insufficient.
 */
export const TIER_ORDER = ["free", "verified", "sme", "enterprise"] as const;

export function requireMinTier(minTier: UserTier) {
  return (req: AuthRequest, _res: Response, next: NextFunction): void => {
    const tier = req.userTier;
    if (tier === undefined) {
      next();
      return;
    }
    const tierIdx = TIER_ORDER.indexOf(tier);
    const minIdx = TIER_ORDER.indexOf(minTier);
    if (tierIdx === -1 || minIdx === -1) {
      next(new AppError("Invalid tier value", 403));
      return;
    }
    if (tierIdx < minIdx) {
      next(
        new AppError(`Insufficient tier. Required at least: ${minTier}`, 403),
      );
      return;
    }
    next();
  };
}
