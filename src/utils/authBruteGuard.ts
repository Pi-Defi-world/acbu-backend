import { cacheService, sanitizeKey } from "./cache";
import { config } from "../config/env";
import { logger } from "../config/logger";
import { maskSecurityIdentifier, normalizeRateLimitIdentifier } from "./identifier";

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
    const canonicalIdentifier = normalizeRateLimitIdentifier(identifier);
    const key = this.getKey(canonicalIdentifier, ip);
    const ttl = config.auth.bruteLockoutMs / 1000;

    await cacheService.increment<{ attempts: number }>(key, "attempts", 1, {
      ttl,
      setOnInsert: { firstAttemptAt: new Date() },
    });

    logger.warn("Auth failure recorded", {
      identifier: maskSecurityIdentifier(canonicalIdentifier),
      ip,
    });
  }

  /**
   * Check if an identifier/IP is currently restricted.
   */
  async getStatus(identifier: string, ip: string): Promise<BruteStatus> {
    const canonicalIdentifier = normalizeRateLimitIdentifier(identifier);
    const key = this.getKey(canonicalIdentifier, ip);
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
    const canonicalIdentifier = normalizeRateLimitIdentifier(identifier);
    const key = this.getKey(canonicalIdentifier, ip);
    await cacheService.delete(key);
  }

  private getKey(identifier: string, ip: string): string {
    return `${KEY_PREFIX}${sanitizeKey(identifier)}:${sanitizeKey(ip)}`;
  }
}

export const authBruteGuard = new AuthBruteGuard();
