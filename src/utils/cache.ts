import { getMongoDB } from "../config/mongodb";
import { logger } from "../config/logger";

const CACHE_COLLECTION = "cache";
const DEFAULT_TTL = 3600; // 1 hour in seconds

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
}

export class CacheService {
  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const db = getMongoDB();
      const collection = db.collection(CACHE_COLLECTION);

      const doc = await collection.findOne({
        key,
        expiresAt: { $gt: new Date() },
      });

      if (doc) {
        return doc.value as T;
      }

      return null;
    } catch (error) {
      logger.error("Cache get error", { key, error });
      return null;
    }
  }

  /**
   * Set a value in cache
   */
  async set<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
    try {
      const db = getMongoDB();
      const collection = db.collection(CACHE_COLLECTION);

      const ttl = options?.ttl || DEFAULT_TTL;
      const expiresAt = new Date(Date.now() + ttl * 1000);

      await collection.updateOne(
        { key },
        {
          $set: {
            key,
            value,
            expiresAt,
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      logger.error("Cache set error", { key, error });
    }
  }

  /**
   * Delete a value from cache
   */
  async delete(key: string): Promise<void> {
    try {
      const db = getMongoDB();
      const collection = db.collection(CACHE_COLLECTION);

      await collection.deleteOne({ key });
    } catch (error) {
      logger.error("Cache delete error", { key, error });
    }
  }

  /**
   * Safely delete cache keys by literal prefix pattern.
   * Fixes B-027: prevent regex-based ReDoS via escaping + length cap.
   */
  async deletePattern(pattern: string): Promise<void> {
    const MAX_REDOS_LENGTH = 128;
    if (
      !pattern ||
      typeof pattern !== "string" ||
      pattern.length > MAX_REDOS_LENGTH
    ) {
      logger.warn("Cache deletePattern: Rejected invalid or over-length pattern.");
      return;
    }

    // Escape regex metacharacters so user input is treated as a literal string.
    const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    try {
      // Anchored prefix regex limits search scope and avoids catastrophic patterns.
      const safeRegex = new RegExp(`^${escapedPattern}`);

      const db = getMongoDB();
      const collection = db.collection(CACHE_COLLECTION);
      await collection.deleteMany({ key: { $regex: safeRegex } });
    } catch (error) {
      logger.error("Cache deletePattern failed safely", { pattern, error });
    }
  }

  /**
   * Clear all expired cache entries
   */
  async clearExpired(): Promise<void> {
    try {
      const db = getMongoDB();
      const collection = db.collection(CACHE_COLLECTION);

      await collection.deleteMany({ expiresAt: { $lt: new Date() } });
    } catch (error) {
      logger.error("Cache clear expired error", { error });
    }
  }

  /**
   * Increment a field in cache atomically with an optional cap.
   * If max is provided, the increment only applies when the current
   * value is below max. Returns null when the cap is reached.
   */
  async increment<T>(
    key: string,
    field: string,
    amount: number,
    options: { ttl: number; max?: number; setOnInsert?: Record<string, any> },
  ): Promise<T | null> {
    try {
      const db = getMongoDB();
      const collection = db.collection(CACHE_COLLECTION);
      const ttl = options.ttl || DEFAULT_TTL;
      const expiresAt = new Date(Date.now() + ttl * 1000);

      // If max is set, only match documents where field is below the cap.
      // MongoDB won't touch the document if the condition fails — atomic rejection.
      const filter: Record<string, any> = { key };
      if (options.max !== undefined) {
        filter[`value.${field}`] = { $lt: options.max };
      }

      const update: any = {
        $inc: { [`value.${field}`]: amount },
        $set: { updatedAt: new Date(), expiresAt },
        $setOnInsert: { key },
      };

      if (options.setOnInsert) {
        Object.keys(options.setOnInsert).forEach((k) => {
          update.$setOnInsert[`value.${k}`] = options.setOnInsert![k];
        });
      }

      const result = await collection.findOneAndUpdate(filter, update, {
        upsert: true,
        returnDocument: "after",
      });

      if (!result) return null;
      return result.value as T;
    } catch (error) {
      logger.error("Cache increment error", { key, error });
      return null;
    }
  }
}

export const cacheService = new CacheService();
