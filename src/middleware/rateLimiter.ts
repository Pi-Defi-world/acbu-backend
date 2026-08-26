import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { config } from "../config/env";
import { getMongoDB } from "../config/mongodb";
import type { ClientRateLimitInfo, Options as RateLimitOptions, Store } from "express-rate-limit";
import { AuthRequest } from "./auth";
import { cacheService, sanitizeKey } from "../utils/cache";
import { logger } from "../config/logger";
import { ErrorCodes } from "../types/errorCodes";
import { circuitBreaker } from "../utils/circuitBreaker";

type FallbackRateLimitEntry = {
  count: number;
  expiresAt: number;
};

type RateLimitDocument = {
  key: string;
  value: {
    count: number;
  };
  expiresAt: Date;
  updatedAt: Date;
  namespace: string;
};

/** Identifies which rate-limiting strategy produced a 429 response. */
export type LimiterContext = "ip" | "api_key";

const fallbackRateLimitStore = new Map<string, FallbackRateLimitEntry>();
const RATE_LIMIT_COLLECTION = "cache";

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

const incrementFallback = (key: string, windowMs: number): { count: number } => {
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
  const cacheKey = `fallback:ip:${sanitizeKey(ip)}:${windowId}`;

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
        code: ErrorCodes.RATE_LIMIT_EXCEEDED,
        error_code: ErrorCodes.RATE_LIMIT_EXCEEDED,
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

class MongoRateLimitStore implements Store {
  public readonly localKeys = false;
  public readonly prefix: string;

  private windowMs = 60_000;

  constructor(namespace: string) {
    this.prefix = `rate_limit:${namespace}`;
  }

  init(options: RateLimitOptions): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    try {
      const db = getMongoDB();
      const collection = db.collection<RateLimitDocument>(RATE_LIMIT_COLLECTION);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.windowMs);
      const namespacedKey = this.buildKey(key);

      const result = await collection.findOneAndUpdate(
        { key: namespacedKey },
        {
          $inc: { "value.count": 1 },
          $set: {
            updatedAt: now,
            expiresAt,
            namespace: this.prefix,
          },
          $setOnInsert: {
            key: namespacedKey,
            namespace: this.prefix,
            value: { count: 0 },
          },
        },
        { upsert: true, returnDocument: "after" },
      );

      const doc = result?.value as unknown as RateLimitDocument | null;
      const totalHits = doc?.value?.count ?? 1;
      return {
        totalHits,
        resetTime: doc?.expiresAt ?? expiresAt,
      };
    } catch (error) {
      logger.error("MongoRateLimitStore.increment failed, using in-memory fallback", {
        namespace: this.prefix,
        error: error instanceof Error ? error.message : String(error),
      });
      fallbackMetrics.failuresTotal++;
      fallbackMetrics.lastFailureAt = Date.now();
      fallbackMetrics.fallbackActivations++;

      const fallbackKey = `${this.prefix}:${key}`;
      const result = incrementFallback(fallbackKey, this.windowMs);
      return {
        totalHits: result.count,
        resetTime: new Date(Date.now() + this.windowMs),
      };
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      const db = getMongoDB();
      const collection = db.collection<RateLimitDocument>(RATE_LIMIT_COLLECTION);
      await collection.updateOne(
        { key: this.buildKey(key) },
        {
          $inc: { "value.count": -1 },
          $set: { updatedAt: new Date() },
        },
      );
    } catch (error) {
      logger.warn(
        "MongoRateLimitStore.decrement failed, skipping (in-memory fallback has no decrement)",
        {
          namespace: this.prefix,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      const db = getMongoDB();
      const collection = db.collection<RateLimitDocument>(RATE_LIMIT_COLLECTION);
      await collection.deleteOne({ key: this.buildKey(key) });
    } catch (error) {
      logger.warn("MongoRateLimitStore.resetKey failed", {
        namespace: this.prefix,
        error: error instanceof Error ? error.message : String(error),
      });
      fallbackRateLimitStore.delete(`${this.prefix}:${key}`);
    }
  }

  async resetAll(): Promise<void> {
    try {
      const db = getMongoDB();
      const collection = db.collection<RateLimitDocument>(RATE_LIMIT_COLLECTION);
      await collection.deleteMany({ namespace: this.prefix });
    } catch (error) {
      logger.warn("MongoRateLimitStore.resetAll failed", {
        namespace: this.prefix,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    try {
      const db = getMongoDB();
      const collection = db.collection<RateLimitDocument>(RATE_LIMIT_COLLECTION);
      const doc = (await collection.findOne({
        key: this.buildKey(key),
        expiresAt: { $gt: new Date() },
      })) as RateLimitDocument | null;

      if (!doc) {
        return undefined;
      }

      return {
        totalHits: doc.value.count,
        resetTime: doc.expiresAt,
      };
    } catch (error) {
      logger.warn("MongoRateLimitStore.get failed", {
        namespace: this.prefix,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private buildKey(key: string): string {
    return `${this.prefix}:${key}`;
  }
}

export const createMongoRateLimitStore = (namespace: string): Store =>
  new MongoRateLimitStore(namespace);

/**
 * Create rate limiter based on API key or IP
 */
export const createRateLimiter = (
  windowMs: number,
  maxRequests: number,
  context: LimiterContext = "ip",
  namespace: string = context,
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
    store: createMongoRateLimitStore(namespace),
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        error: {
          code: ErrorCodes.RATE_LIMIT_EXCEEDED,
          error_code: ErrorCodes.RATE_LIMIT_EXCEEDED,
          message,
          limitType: context,
        },
      });
    },
  });
};

/**
 * Rate limiter for API key-based requests with circuit breaker fallback.
 * Uses atomic MongoDB $inc with a cap to prevent race conditions.
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
  const cacheKey = `rate_limit:api_key:${sanitizeKey(req.apiKey.id)}:${windowId}`;

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
    // Atomic increment with cap — MongoDB only increments when count < max.
    // Returns null when the cap is reached, no separate count check needed.
    const cached = await cacheService.increment<{ count: number }>(cacheKey, "count", 1, {
      ttl: windowMs / 1000,
      max: maxRequests,
    });

    // Success - record for circuit breaker
    circuitBreaker.recordSuccess();

    if (cached === null) {
      // null means cap was hit — return 429 directly
      res.status(429).json({
        error: {
          code: ErrorCodes.RATE_LIMIT_EXCEEDED,
          error_code: ErrorCodes.RATE_LIMIT_EXCEEDED,
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
  "ip",
  "standard",
);

/**
 * Stricter rate limiter for auth endpoints (signup, signin, verify-2fa)
 */
export const authRateLimiter = createRateLimiter(
  config.authRateLimitWindowMs,
  config.authRateLimitMaxRequests,
  "ip",
  "auth",
);

/**
 * Rate limiter for admin endpoints
 */
export const adminRateLimiter = createRateLimiter(
  config.adminRateLimitWindowMs,
  config.adminRateLimitMaxRequests,
  "ip",
  "admin",
);

/**
 * Per-user/IP rate limiter for sensitive auth endpoints: 2FA verify, passcode reset.
 * Fixes #269 — brute-force of 2FA tokens and passcodes is possible at line speed
 * when only an IP-based limiter is applied.
 *
 * Strategy: derive a composite key from the request body's identifier/challenge_token
 * combined with the client IP so that:
 *   - A single user cannot be brute-forced from many IPs simultaneously.
 *   - A single IP cannot brute-force many accounts simultaneously.
 *
 * Limits: 5 attempts per 15 minutes per (user-identifier + IP) pair.
 * Falls back to IP-only key when no user identifier is present in the body.
 */
const TWO_FA_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const TWO_FA_MAX_REQUESTS = 5;

export const twoFaRateLimiter = (req: AuthRequest, res: Response, next: NextFunction): void => {
  // Extract a user-scoped identifier from the request body.
  // For /signin: body.identifier (username/email/phone)
  // For /signin/verify-2fa: body.challenge_token (contains userId in jti prefix)
  // For /passcode/reset: body.identifier or body.email
  const body = (req.body ?? {}) as Record<string, unknown>;
  const userHint =
    (typeof body.identifier === "string" && body.identifier.slice(0, 32)) ||
    (typeof body.challenge_token === "string" && body.challenge_token.slice(-16)) ||
    (typeof body.email === "string" && body.email.slice(0, 32)) ||
    "anon";

  const ip = req.ip || "unknown";
  const compositeKey = `2fa:${ip}:${userHint}`;

  const now = Date.now();
  const windowId = Math.floor(now / TWO_FA_WINDOW_MS);
  const storeKey = `${compositeKey}:${windowId}`;

  const result = incrementFallback(storeKey, TWO_FA_WINDOW_MS);

  if (result.count > TWO_FA_MAX_REQUESTS) {
    logger.warn("2FA rate limit exceeded", {
      ip,
      userHint,
      count: result.count,
      limit: TWO_FA_MAX_REQUESTS,
    });
    res.status(429).json({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many authentication attempts. Please wait 15 minutes before trying again.",
      },
    });
    return;
  }

  next();
};

/**
 * Middleware to inject fallback state into request context for downstream logging
 */
export const injectFallbackState = (req: AuthRequest, _res: Response, next: NextFunction): void => {
  (req as any).rateLimiterState = {
    circuitState: circuitBreaker.getState(),
    isFallback: !circuitBreaker.canExecute(),
    fallbackMetrics: { ...fallbackMetrics },
  };
  next();
};

// Export for testing
export { circuitBreaker, fallbackMetrics, FALLBACK_MAX_REQUESTS_PER_IP, fallbackRateLimitStore };
