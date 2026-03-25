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
   * Delete multiple keys containing a specific substring pattern.
   * Input is automatically escaped to prevent ReDoS (Regular Expression Denial of Service).
   */
  async deletePattern(pattern: string): Promise<void> {
    try {
      const db = getMongoDB();
      const collection = db.collection(CACHE_COLLECTION);

      // Sanitize input to prevent ReDoS (Regular Expression Denial of Service)
      const sanitizedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(sanitizedPattern);

      await collection.deleteMany({ key: { $regex: regex } });
    } catch (error) {
      logger.error("Cache delete pattern error", { pattern, error });
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
   * Increment a value in cache atomically
   */
  async increment<T>(
    key: string,
    field: string,
    amount: number,
    options: { ttl: number; setOnInsert?: Record<string, any> },
  ): Promise<T | null> {
    try {
      const db = getMongoDB();
      const collection = db.collection(CACHE_COLLECTION);
      const ttl = options.ttl || DEFAULT_TTL;
      const expiresAt = new Date(Date.now() + ttl * 1000);

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

      const result = await collection.findOneAndUpdate({ key }, update, {
        upsert: true,
        returnDocument: "after",
      });

      return result?.value as T;
    } catch (error) {
      logger.error("Cache increment error", { key, error });
      return null;
    }
  }
}

export const cacheService = new CacheService();
