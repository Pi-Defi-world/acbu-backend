import { redisService } from "../services/cache/redisService";

export function getRedisClient() {
  return redisService.getClient();
}
