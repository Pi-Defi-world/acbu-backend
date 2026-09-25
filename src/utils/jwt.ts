/**
 * JWT helpers for 2FA challenge tokens.
 * Challenge tokens use dedicated config and include aud/iss claims for purpose binding.
 * These tokens CANNOT be used for API access and have strict expiration (5m).
 *
 * Security model:
 * - Challenge tokens have aud: "2fa_challenge" and iss: "acbu/auth"
 * - API session tokens have aud: "api_session" and are signed with a different (optional) secret
 * - Verification enforces audience to prevent token confusion
 * - jti (JWT ID) uniqueness is enforced via an in-process deny-list (#288)
 *   so a stolen token replayed within its 5-minute window is rejected.
 *   For multi-instance deployments swap the in-process Map for a shared Redis SET.
 */
import jwt from "jsonwebtoken";
import { config } from "../config/env";
import { logger } from "../config/logger";
import { EXPECTED_JWT_TYP, verifyJwt } from "../middleware/authMiddleware";

// ---------------------------------------------------------------------------
// JTI deny-list — fixes #288
// ---------------------------------------------------------------------------

interface DenyEntry {
  expiresAt: number; // Unix ms
}

const jtiDenyList = new Map<string, DenyEntry>();

/** Prune expired entries to prevent unbounded memory growth. */
function pruneExpiredJtis(): void {
  const now = Date.now();
  for (const [jti, entry] of jtiDenyList.entries()) {
    if (entry.expiresAt <= now) {
      jtiDenyList.delete(jti);
    }
  }
}

// Prune every 5 minutes — matches the challenge token lifetime.
const jtiPruneTimer = setInterval(pruneExpiredJtis, 5 * 60 * 1000);
jtiPruneTimer.unref();

/**
 * Add a jti to the deny-list until its natural expiry.
 * @param jti - The JWT ID to revoke.
 * @param exp - Token expiry in Unix *seconds* (from JWT payload).
 */
export function revokeJti(jti: string, exp: number): void {
  jtiDenyList.set(jti, { expiresAt: exp * 1000 });
}

/**
 * Returns true if the jti has already been used (is in the deny-list).
 */
export function isJtiRevoked(jti: string): boolean {
  pruneExpiredJtis();
  return jtiDenyList.has(jti);
}

/** Exposed for testing only. */
export { jtiDenyList };

const CHALLENGE_EXPIRY = "5m";
const CHALLENGE_AUDIENCE = "2fa_challenge";
const CHALLENGE_ISSUER = "acbu/auth";

export interface ChallengePayload {
  userId: string;
  aud?: string;
  iss?: string;
  iat?: number;
  exp?: number;
  jti?: string; // JWT ID for revocation tracking (optional)
}

/**
 * Get the secret key for challenge tokens.
 * Uses a dedicated env var if available, otherwise falls back to JWT_SECRET.
 * In production, should use a separate, rotated secret.
 */
function getChallengeSecret(): string {
  const secret = config.challengeTokenSecret;

  if (!secret) {
    throw new Error("CHALLENGE_TOKEN_SECRET or JWT_SECRET is required");
  }
  return secret;
}

/**
 * Sign a 2FA challenge token for the given user (short-lived JWT).
 * Includes aud and iss claims for strict purpose binding.
 */
export function signChallengeToken(userId: string): string {
  const secret = getChallengeSecret();

  const payload: ChallengePayload = {
    userId,
    aud: CHALLENGE_AUDIENCE,
    iss: CHALLENGE_ISSUER,
  };

  return jwt.sign(payload, secret, {
    expiresIn: CHALLENGE_EXPIRY,
    jwtid: `chal_${userId}_${Date.now()}`, // Unique token ID for tracking
    header: { typ: EXPECTED_JWT_TYP, alg: "HS256" },
  });
}

/**
 * Verify and decode a 2FA challenge token.
 * Enforces aud and iss claims to prevent token reuse.
 * Enforces jti uniqueness — a token can only be used once (#288).
 * Throws if invalid, expired, already used, or used for wrong purpose.
 */
export function verifyChallengeToken(token: string): ChallengePayload {
  const secret = getChallengeSecret();

  try {
    const decoded = verifyJwt(token, secret, {
      audience: CHALLENGE_AUDIENCE,
      issuer: CHALLENGE_ISSUER,
      clockTolerance: config.jwtClockToleranceSeconds,
    }) as ChallengePayload;

    // Additional explicit checks
    if (decoded.aud !== CHALLENGE_AUDIENCE) {
      logger.warn("Challenge token audience mismatch", {
        expected: CHALLENGE_AUDIENCE,
        received: decoded.aud,
      });
      throw new Error("Invalid token audience");
    }

    if (decoded.iss !== CHALLENGE_ISSUER) {
      logger.warn("Challenge token issuer mismatch", {
        expected: CHALLENGE_ISSUER,
        received: decoded.iss,
      });
      throw new Error("Invalid token issuer");
    }

    if (typeof decoded.iat === "number") {
      const now = Math.floor(Date.now() / 1000);
      const maxAllowedIat = now + config.jwtClockToleranceSeconds;
      if (decoded.iat > maxAllowedIat) {
        logger.warn("Challenge token issued-at is beyond clock tolerance", {
          issuedAt: decoded.iat,
          maxAllowedIat,
        });
        throw new Error("Invalid token issued-at");
      }
    }

    // jti replay check — fixes #288
    if (decoded.jti) {
      if (isJtiRevoked(decoded.jti)) {
        logger.warn("Challenge token jti already used (replay attempt)", {
          jti: decoded.jti,
          userId: decoded.userId,
        });
        throw new Error("Challenge token has already been used");
      }
    }

    return decoded;
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      logger.warn("Challenge token verification failed", {
        error: error.message,
      });
      throw new Error("Invalid or expired challenge token");
    }
    throw error;
  }
}

/**
 * Strictly reject challenge tokens when trying to use them as API keys.
 * This prevents accidental or malicious reuse across flows.
 */
export function rejectIfChallengeToken(decoded: Record<string, unknown>): void {
  if (decoded.aud === CHALLENGE_AUDIENCE && decoded.iss === CHALLENGE_ISSUER) {
    logger.error("Attempted to use 2FA challenge token for API access");
    throw new Error("Challenge tokens cannot be used for API access");
  }
}
