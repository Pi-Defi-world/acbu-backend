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
import { redisService } from "../services/cache/redisService";

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

const RATE_LIMIT_COLLECTION = "cache";

// Stricter fallback limits during cache outage (5x stricter than normal 100/min)
const FALLBACK_MAX_REQUESTS_PER_IP = 20;
const FALLBACK_WINDOW_MS = 60_000; // 1 minute
const FALLBACK_MAX_ENTRIES = 10_000;
const FALLBACK_CLEANUP_INTERVAL_MS = 60_000;

type FallbackRateLimitEntry = {
  count: number;
  expiresAt: number;
};

export const fallbackRateLimitStore = new Map<string, FallbackRateLimitEntry>();
let lastFallbackCleanupAt = 0;

// Metrics tracking for observability
const fallbackMetrics = {
  failuresTotal: 0,
  fallbackActivations: 0,
  rejectionsInFallback: 0,
  lastFailureAt: null as number | null,
};

const cleanupFallbackRateLimitStore = (now: number): void => {
  if (
    now - lastFallbackCleanupAt < FALLBACK_CLEANUP_INTERVAL_MS &&
    fallbackRateLimitStore.size < FALLBACK_MAX_ENTRIES
  ) {
    return;
  }

  for (const [key, entry] of fallbackRateLimitStore) {
    if (entry.expiresAt <= now) {
      fallbackRateLimitStore.delete(key);
    }
  }
  lastFallbackCleanupAt = now;
};

const incrementInMemoryFallback = (key: string, windowMs: number): { count: number } => {
  const now = Date.now();
  const existing = fallbackRateLimitStore.get(key);
  if (existing && existing.expiresAt > now) {
    existing.count++;
    return { count: existing.count };
  }
  if (existing) fallbackRateLimitStore.delete(key);

  cleanupFallbackRateLimitStore(now);
  if (fallbackRateLimitStore.size >= FALLBACK_MAX_ENTRIES) {
    logger.error("In-memory rate-limit fallback capacity exhausted; rejecting request", {
      maxEntries: FALLBACK_MAX_ENTRIES,
    });
    return { count: Number.MAX_SAFE_INTEGER };
  }

  const entry = { count: 1, expiresAt: now + windowMs };
  fallbackRateLimitStore.set(key, entry);
  return { count: entry.count };
};

const incrementFallback = async (
  key: string,
  windowMs: number,
): Promise<{ count: number }> => {
  const localEntry = fallbackRateLimitStore.get(key);
  if (localEntry && localEntry.expiresAt > Date.now()) {
    return incrementInMemoryFallback(key, windowMs);
  }

  try {
    const redis = redisService.getClient();
    const count = await redis.incr(key);

    if (count === 1) {
      await redis.expire(key, Math.ceil(windowMs / 1000));
    }

    return { count };
  } catch (error) {
    logger.warn("Redis fallback increment failed; using in-memory rate limiter", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return incrementInMemoryFallback(key, windowMs);
  }
};

/**
 * Enforce strict fallback rate limit when cache is unavailable
 * This ensures NO fail-open behavior during cache outages
 */
const enforceFallbackLimit = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
  maxRequests: number,
): Promise<void> => {
  const ip = (req as any).ip || "unknown";
  const now = Date.now();
  const windowId = Math.floor(now / FALLBACK_WINDOW_MS);
  const cacheKey = `fallback:ip:${sanitizeKey(ip)}:${windowId}`;

  try {
    const result = await incrementFallback(cacheKey, FALLBACK_WINDOW_MS);

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
  } catch (error) {
    logger.error("Fallback rate limiter error, denying request", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(429).json({
      error: {
        code: ErrorCodes.RATE_LIMIT_EXCEEDED,
        error_code: ErrorCodes.RATE_LIMIT_EXCEEDED,
        message: "Rate limit check failed",
      },
    });
  }
};

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
      logger.error("MongoRateLimitStore.increment failed, using Redis fallback", {
        namespace: this.prefix,
        error: error instanceof Error ? error.message : String(error),
      });
      fallbackMetrics.failuresTotal++;
      fallbackMetrics.lastFailureAt = Date.now();
      fallbackMetrics.fallbackActivations++;

      const fallbackKey = `${this.prefix}:${key}`;
      const result = await incrementFallback(fallbackKey, this.windowMs);
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

      try {
        const redis = redisService.getClient();
        await redis.del(`${this.prefix}:${key}`);
      } catch (redisError) {
        logger.warn("Redis resetKey also failed", {
          error: redisError instanceof Error ? redisError.message : String(redisError),
        });
      }
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

/**
 * Shared-store rate limiter store backed by Redis, with a Mongo-backed
 * fallback. Used for security-sensitive limiters (e.g. 2FA verification)
 * so limits are enforced across all instances rather than per-process.
 */
class SharedRateLimitStore implements Store {
  public readonly localKeys = false;
  public readonly prefix: string;

  private windowMs = 60_000;
  private readonly mongoStore: MongoRateLimitStore;

  constructor(namespace: string) {
    this.prefix = `rate_limit:${namespace}`;
    this.mongoStore = new MongoRateLimitStore(namespace);
  }

  init(options: RateLimitOptions): void {
    this.windowMs = options.windowMs;
    this.mongoStore.init(options);
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    try {
      const redis = redisService.getClient();
      const redisKey = this.buildKey(key);
      const count = await redis.incr(redisKey);

      if (count === 1) {
        await redis.expire(redisKey, Math.ceil(this.windowMs / 1000));
      }

      const ttlMs = await redis.pttl(redisKey);
      const resetTime = new Date(Date.now() + (ttlMs > 0 ? ttlMs : this.windowMs));

      return { totalHits: count, resetTime };
    } catch (error) {
      logger.warn("SharedRateLimitStore Redis increment failed, using Mongo store", {
        namespace: this.prefix,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.mongoStore.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      const redis = redisService.getClient();
      await redis.decr(this.buildKey(key));
    } catch (error) {
      logger.warn("SharedRateLimitStore Redis decrement failed, using Mongo store", {
        namespace: this.prefix,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.mongoStore.decrement(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      const redis = redisService.getClient();
      await redis.del(this.buildKey(key));
    } catch (error) {
      logger.warn("SharedRateLimitStore Redis resetKey failed, using Mongo store", {
        namespace: this.prefix,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.mongoStore.resetKey(key);
    }
  }

  async resetAll(): Promise<void> {
    try {
      const redis = redisService.getClient();
      const keys = await redis.keys(`${this.prefix}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      logger.warn("SharedRateLimitStore Redis resetAll failed, using Mongo store", {
        namespace: this.prefix,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.mongoStore.resetAll();
    }
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    try {
      const redis = redisService.getClient();
      const redisKey = this.buildKey(key);
      const value = await redis.get(redisKey);

      if (value === null) {
        return undefined;
      }

      const ttlMs = await redis.pttl(redisKey);
      return {
        totalHits: Number(value),
        resetTime: new Date(Date.now() + (ttlMs > 0 ? ttlMs : this.windowMs)),
      };
    } catch (error) {
      logger.warn("SharedRateLimitStore Redis get failed, using Mongo store", {
        namespace: this.prefix,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.mongoStore.get(key);
    }
  }

  private buildKey(key: string): string {
    return `${this.prefix}:${key}`;
  }
}

export const createMongoRateLimitStore = (namespace: string): Store =>
  new MongoRateLimitStore(namespace);

export const createRateLimiter = (
  windowMs: number,
  maxRequests: number,
  context: LimiterContext = "ip",
  namespace = context,
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

export const apiKeyRateLimiter = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.apiKey) return next();

  const maxRequests = req.apiKey.rateLimit || config.rateLimitMaxRequests;
  const windowMs = config.rateLimitWindowMs;
  const windowId = Math.floor(Date.now() / windowMs);
  const cacheKey = `rate_limit:api_key:${sanitizeKey(req.apiKey.id)}:${windowId}`;

  if (!circuitBreaker.canExecute()) {
    logger.warn("Circuit breaker OPEN, using fallback rate limiter", {
      apiKeyId: req.apiKey.id,
      circuitState: circuitBreaker.getState(),
    });
    fallbackMetrics.fallbackActivations++;
    await enforceFallbackLimit(req, res, next, FALLBACK_MAX_REQUESTS_PER_IP);
    return;
  }

  try {
    const cached = await cacheService.increment<{ count: number }>(
      cacheKey,
      "count",
      1,
      { ttl: windowMs / 1000, max: maxRequests },
    );
    circuitBreaker.recordSuccess();

    if (cached === null) {
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
    circuitBreaker.recordFailure();
    fallbackMetrics.failuresTotal++;
    fallbackMetrics.lastFailureAt = Date.now();
    fallbackMetrics.fallbackActivations++;
    logger.error("Cache increment failed, activating fallback", {
      cacheKey,
      error: error instanceof Error ? error.message : String(error),
      circuitState: circuitBreaker.getState(),
    });
    await enforceFallbackLimit(req, res, next, FALLBACK_MAX_REQUESTS_PER_IP);
  }
};

export const standardRateLimiter = createRateLimiter(
  config.rateLimitWindowMs,
  config.rateLimitMaxRequests,
  "ip",
  "standard",
);

export const authRateLimiter = createRateLimiter(
  config.authRateLimitWindowMs,
  config.authRateLimitMaxRequests,
  "ip",
  "auth",
);

export const adminRateLimiter = createRateLimiter(
  config.adminRateLimitWindowMs,
  config.adminRateLimitMaxRequests,
  "ip",
  "admin",
);

const TWO_FA_WINDOW_MS = 15 * 60 * 1000;
const TWO_FA_MAX_REQUESTS = 5;
const twoFaStore = new SharedRateLimitStore("two_fa");
twoFaStore.init({ windowMs: TWO_FA_WINDOW_MS } as RateLimitOptions);

export const twoFaRateLimiter = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const body = ((req as any).body ?? {}) as Record<string, unknown>;
  const userHint =
    (typeof body.identifier === "string" && body.identifier.slice(0, 32)) ||
    (typeof body.challenge_token === "string" && body.challenge_token.slice(-16)) ||
    (typeof body.email === "string" && body.email.slice(0, 32)) ||
    "anon";
  const ip = req.ip || "unknown";
  const windowId = Math.floor(Date.now() / TWO_FA_WINDOW_MS);

  try {
    const result = await twoFaStore.increment(`${ip}:${userHint}:${windowId}`);
    if (result.totalHits > TWO_FA_MAX_REQUESTS) {
      res.status(429).json({
        error: {
          code: ErrorCodes.RATE_LIMIT_EXCEEDED,
          message:
            "Too many authentication attempts. Please wait 15 minutes before trying again.",
        },
      });
      return;
    }
    next();
  } catch (error) {
    logger.error("2FA rate limiter failed; denying request", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(429).json({
      error: {
        code: ErrorCodes.RATE_LIMIT_EXCEEDED,
        message: "Authentication service temporarily unavailable",
      },
    });
  }
};

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

export {
  circuitBreaker,
  fallbackMetrics,
  FALLBACK_MAX_REQUESTS_PER_IP,
};
