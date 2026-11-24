import Redis, { type RedisOptions } from "ioredis";
import { config } from "../../config/env";
import { logger } from "../../config/logger";

export const READONLY_ERROR_PREFIX = "READONLY";

export type RedisFailoverMetrics = {
  readonlyRetries: number;
  reconnects: number;
};

const failoverMetrics: RedisFailoverMetrics = {
  readonlyRetries: 0,
  reconnects: 0,
};

export function isReadonlyError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.startsWith(READONLY_ERROR_PREFIX);
}

/**
 * During Sentinel failover a promoted replica can briefly return READONLY.
 * Reconnect and resend the failed command so writes recover automatically.
 */
export function createReconnectOnError(): NonNullable<RedisOptions["reconnectOnError"]> {
  return (error: Error) => {
    if (isReadonlyError(error)) {
      failoverMetrics.reconnects += 1;
      logger.warn("Redis READONLY error during failover; reconnecting", {
        error: error.message,
      });
      return 2;
    }

    return false;
  };
}

export function buildRedisOptions(): RedisOptions {
  const redis = config.redis;
  const base: RedisOptions = {
    reconnectOnError: createReconnectOnError(),
    maxRetriesPerRequest: redis.maxRetriesPerRequest,
    retryStrategy: (times) => Math.min(times * 100, 2000),
    enableReadyCheck: true,
    lazyConnect: true,
  };

  if (redis.sentinels.length > 0 && redis.sentinelName) {
    return {
      ...base,
      sentinels: redis.sentinels,
      name: redis.sentinelName,
      password: redis.password || undefined,
    };
  }

  return base;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getRedisFailoverMetrics(): RedisFailoverMetrics {
  return { ...failoverMetrics };
}

/** Reset failover metrics (for tests). */
export function resetRedisFailoverMetrics(): void {
  failoverMetrics.readonlyRetries = 0;
  failoverMetrics.reconnects = 0;
}

export class RedisService {
  private client: Redis | null = null;

  getClient(): Redis {
    if (!this.client) {
      const options = buildRedisOptions();
      this.client = config.redis.url ? new Redis(config.redis.url, options) : new Redis(options);
      this.client.on("reconnecting", () => {
        failoverMetrics.reconnects += 1;
        logger.info("Redis client reconnecting after failover");
      });
    }

    return this.client;
  }

  async connect(): Promise<void> {
    const client = this.getClient();
    if (client.status === "wait") {
      await client.connect();
    }
  }

  async reconnect(): Promise<void> {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }

    await this.connect();
  }

  async executeWithReadonlyRetry<T>(operation: () => Promise<T>): Promise<T> {
    const { readonlyRetryAttempts, readonlyRetryDelayMs } = config.redis;
    let lastError: unknown;

    for (let attempt = 1; attempt <= readonlyRetryAttempts; attempt++) {
      try {
        await this.connect();
        return await operation();
      } catch (error) {
        lastError = error;
        if (!isReadonlyError(error) || attempt === readonlyRetryAttempts) {
          throw error;
        }

        failoverMetrics.readonlyRetries += 1;
        logger.warn("Redis write failed with READONLY; retrying after reconnect", {
          attempt,
          maxAttempts: readonlyRetryAttempts,
        });

        await this.reconnect();
        await sleep(readonlyRetryDelayMs * attempt);
      }
    }

    throw lastError;
  }

  async get(key: string): Promise<string | null> {
    return this.executeWithReadonlyRetry(async () => {
      return this.getClient().get(key);
    });
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<"OK" | null> {
    return this.executeWithReadonlyRetry(async () => {
      if (ttlSeconds) {
        return this.getClient().set(key, value, "EX", ttlSeconds);
      }

      return this.getClient().set(key, value);
    });
  }

  /**
   * Atomically set `key` only when it does not already exist (`SET ... NX EX`).
   *
   * Returns true when this call created the key (the caller won the claim) and
   * false when the key was already present. Used for cross-instance
   * single-use/deny-list semantics, e.g. the 2FA challenge JTI store (#984).
   */
  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    return this.executeWithReadonlyRetry(async () => {
      const result = await this.getClient().set(key, value, "EX", ttlSeconds, "NX");
      return result === "OK";
    });
  }

  async del(...keys: string[]): Promise<number> {
    return this.executeWithReadonlyRetry(async () => {
      return this.getClient().del(...keys);
    });
  }

  async incr(key: string): Promise<number> {
    return this.executeWithReadonlyRetry(async () => {
      return this.getClient().incr(key);
    });
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
  }
}

export const redisService = new RedisService();
