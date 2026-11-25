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
import { getRedisClient } from "../config/redis";

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

// Metrics tracking for observability
const fallbackMetrics = {
  failuresTotal: 0,
  fallbackActivations: 0,
  rejectionsInFallback: 0,
  lastFailureAt: null as number | null,
};

const incrementFallback = async (key: string, windowMs: number): Promise<{ count: number }> => {
  try {
    const redis = getRedisClient();
    const count = await redis.incr(key);

    if (count === 1) {
      await redis.expire(key, Math.ceil(windowMs / 1000));
    }

    return { count };
  } catch (error) {
    logger.error("Redis fallback increment failed", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
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

      try {
        const fallbackKey = `${this.prefix}:${key}`;
        const result = await incrementFallback(fallbackKey, this.windowMs);
        return {
          totalHits: result.count,
          resetTime: new Date(Date.now() + this.windowMs),
        };
      } catch (redisError) {
        logger.error("Redis fallback also failed, returning permissive response", {
          error: redisError instanceof Error ? redisError.message : String(redisError),
        });
        throw new Error("Both MongoDB and Redis rate limiting failed");
      }
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
        const redis = getRedisClient();
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
      const redis = getRedisClient();
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
      const redis = getRedisClient();
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
      const redis = getRedisClient();
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
      const redis = getRedisClient();
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
      const redis = getRedisClient();
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

/* … truncated 6814 chars — edit only what you need near the top … */
