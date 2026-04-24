import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { config } from "../config/env";
import { AuthRequest } from "./auth";
import { cacheService } from "../utils/cache";
import { logger } from "../config/logger";
import { circuitBreaker } from "../utils/circuitBreaker";

type FallbackRateLimitEntry = {
  count: number;
  expiresAt: number;
};

/** Identifies which rate-limiting strategy produced a 429 response. */
export type LimiterContext = "ip" | "api_key";

const fallbackRateLimitStore = new Map<string, FallbackRateLimitEntry>();

// Stricter fallback limits during cache outage (5x stricter than normal 100/min)
const FALLBACK_MAX_REQUESTS_PER_IP = 20;
const FALLBACK_WINDOW_MS = 60_000; // 1 minute
const FALLBACK_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Metrics tracking for observability
const fallbackMetrics = {
  failuresTotal: 0,
  fallbackActivations: 0,
  rejectionsInFallback: 0,
  lastFailureAt: null as number | null,
};

const incrementFallback = (
  key: string,
  windowMs: number,
): { count: number } => {
  const now = Date.now();
  const existing = fallbackRateLimitStore.get(key);
  if (!existing || existing.expiresAt <= now) {
    const entry = { count: 1, expiresAt: now + windowMs };
    fallbackRateLimitStore.set(key, entry);
    return { count: entry.count };
  }

  existing.count += 1;
  fallbackRateLimitStore.set(key, existing);
  return { count: existing.count };
};

/**
 * Enforce strict fallback rate limit when cache is unavailable
 * This ensures NO fail-open behavior during cache outages
 */
const enforceFallbackLimit = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
  maxRequests: number,
): void => {
  const ip = req.ip || "unknown";
  const now = Date.now();
  const windowId = Math.floor(now / FALLBACK_WINDOW_MS);
  const cacheKey = `fallback:ip:${ip}:${windowId}`;

  const result = incrementFallback(cacheKey, FALLBACK_WINDOW_MS);

  if (result.count > maxRequests) {
    fallbackMetrics.rejectionsInFallback++;
    logger.warn("Rate limit rejected in fallback mode", {
      ip,
      count: result.count,
      limit: maxRequests,
      mode: "fallback",
    });
    res.status(429).json({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Rate limit exceeded (degraded mode)",
      },
    });
    return;
  }

  next();
};

// Periodic cleanup of expired fallback entries to prevent memory leaks
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  let cleanedCount = 0;
  for (const [key, entry] of fallbackRateLimitStore.entries()) {
    if (entry.expiresAt <= now) {
      fallbackRateLimitStore.delete(key);
      cleanedCount++;
    }
  }
  if (cleanedCount > 0) {
    logger.debug("Cleaned up expired fallback rate limit entries", {
      cleanedCount,
      remainingSize: fallbackRateLimitStore.size,
    });
  }
}, FALLBACK_CLEANUP_INTERVAL_MS);

// Unref to prevent blocking process exit
cleanupTimer.unref();

/**
 * Create rate limiter based on API key or IP
 */
export const createRateLimiter = (
  windowMs: number,
  maxRequests: number,
  context: LimiterContext = "ip",
) => {
  const message =
    context === "ip"
      ? "Too many requests from this IP address, please try again later."
      : "API key rate limit exceeded, please try again later.";

  return rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message,
          limitType: context,
        },
      });
    },
  });
};

/**
 * Rate limiter for API key-based requests with circuit breaker fallback
 */
export const apiKeyRateLimiter = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.apiKey) {
    return next();
  }

  const maxRequests = req.apiKey.rateLimit || config.rateLimitMaxRequests;
  const windowMs = config.rateLimitWindowMs;
  const windowId = Math.floor(Date.now() / windowMs);
  const cacheKey = `rate_limit:api_key:${req.apiKey.id}:${windowId}`;

  // Check circuit breaker state - if OPEN, use fallback immediately
  if (!circuitBreaker.canExecute()) {
    logger.warn("Circuit breaker OPEN, using fallback rate limiter", {
      apiKeyId: req.apiKey.id,
      circuitState: circuitBreaker.getState(),
    });
    fallbackMetrics.fallbackActivations++;
    enforceFallbackLimit(req, res, next, FALLBACK_MAX_REQUESTS_PER_IP);
    return;
  }

  try {
    const cached = await cacheService.increment<{ count: number }>(
      cacheKey,
      "count",
      1,
      { ttl: windowMs / 1000 },
    );

    // Success - record for circuit breaker
    circuitBreaker.recordSuccess();

    if (!cached) {
      // Cache returned null but didn't throw - use fallback
      fallbackMetrics.fallbackActivations++;
      logger.warn("Cache returned null, using fallback", { cacheKey });
      enforceFallbackLimit(req, res, next, FALLBACK_MAX_REQUESTS_PER_IP);
      return;
    }

    if (cached.count > maxRequests) {
      res.status(429).json({
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "API key rate limit exceeded, please try again later.",
          limitType: "api_key" as LimiterContext,
        },
      });
      return;
    }

    next();
  } catch (error) {
    // Cache failure - record for circuit breaker
    circuitBreaker.recordFailure();
    fallbackMetrics.failuresTotal++;
    fallbackMetrics.lastFailureAt = Date.now();

    logger.error("Cache increment failed, activating fallback", {
      cacheKey,
      error: error instanceof Error ? error.message : String(error),
      circuitState: circuitBreaker.getState(),
    });

    fallbackMetrics.fallbackActivations++;
    enforceFallbackLimit(req, res, next, FALLBACK_MAX_REQUESTS_PER_IP);
  }
};

/**
 * Standard rate limiter for general endpoints
 */
export const standardRateLimiter = createRateLimiter(
  config.rateLimitWindowMs,
  config.rateLimitMaxRequests,
);

/**
 * Middleware to inject fallback state into request context for downstream logging
 */
export const injectFallbackState = (
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): void => {
  (req as any).rateLimiterState = {
    circuitState: circuitBreaker.getState(),
    isFallback: !circuitBreaker.canExecute(),
    fallbackMetrics: { ...fallbackMetrics },
  };
  next();
};

// Export for testing
export { circuitBreaker, fallbackMetrics, FALLBACK_MAX_REQUESTS_PER_IP };
