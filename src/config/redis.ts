import { redisService } from "../services/cache/redisService";

/**
 * Shared Redis client used by middleware and services that need direct Redis
 * commands. RedisService owns connection lifecycle and failover retries.
 */
export function getRedisClient() {
  return redisService.getClient();
}
