import { cacheService } from "./cache";
import { config } from "../config/env";
import { logger } from "../config/logger";

const KEY_PREFIX = "brute:";

export interface BruteStatus {
  attempts: number;
  locked: boolean;
  requiresCaptcha: boolean;
  nextAttemptAt?: Date;
}

export class AuthBruteGuard {
  /**
   * Record a failed attempt for an identifier (username/email/phone) and/or IP.
   */
  async recordFailure(identifier: string, ip: string): Promise<void> {
    const key = this.getKey(identifier, ip);
    const ttl = config.auth.bruteLockoutMs / 1000;

    await cacheService.increment<{ attempts: number }>(key, "attempts", 1, {
      ttl,
      setOnInsert: { firstAttemptAt: new Date() },
    });

    logger.warn("Auth failure recorded", { identifier, ip });
  }

  /**
   * Check if an identifier/IP is currently restricted.
   */
  async getStatus(identifier: string, ip: string): Promise<BruteStatus> {
    const key = this.getKey(identifier, ip);
    const data = await cacheService.get<{
      attempts: number;
      firstAttemptAt: string;
    }>(key);

    if (!data) {
      return { attempts: 0, locked: false, requiresCaptcha: false };
    }

    const attempts = data.attempts || 0;
    const maxAttempts = config.auth.bruteMaxAttempts;

    // We require CAPTCHA after maxAttempts / 2
    const requiresCaptcha = attempts >= Math.ceil(maxAttempts / 2);
    const locked = attempts >= maxAttempts;

    return {
      attempts,
      locked,
      requiresCaptcha,
    };
  }

  /**
   * Reset failed attempts after a successful login.
   */
  async reset(identifier: string, ip: string): Promise<void> {
    const key = this.getKey(identifier, ip);
    await cacheService.delete(key);
  }

  private getKey(identifier: string, ip: string): string {
    // Combine identifier and IP for granular tracking.
    // In some cases you might want to track them separately, but combining
    // prevents a single IP from brute-forcing many accounts OR a single account
    // from being targeted from many IPs (though the latter is harder to stop this way).
    return `${KEY_PREFIX}${identifier}:${ip}`;
  }
}

export const authBruteGuard = new AuthBruteGuard();
