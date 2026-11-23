import { Request, Response, NextFunction } from "express";

/**
 * Middleware to set Cache-Control and Surrogate-Control headers for semi-static API responses.
 * Max-age is set to 1 hour (3600 seconds), and CDNs (Surrogate-Control) can cache it for 24 hours (86400 seconds).
 */
export function cacheSemiStatic(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=600");
  res.setHeader("Surrogate-Control", "max-age=86400");
  next();
}

/** Cache-Control for content-addressed / versioned static assets (W11-AUD-024). */
export const IMMUTABLE_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Cache-Control for dynamic documentation: cache but always revalidate (W11-AUD-024). */
export const NO_CACHE = "no-cache";

/** Middleware that marks a response as `no-cache` (must revalidate before reuse). */
export function cacheNoCache(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Cache-Control", NO_CACHE);
  next();
}
