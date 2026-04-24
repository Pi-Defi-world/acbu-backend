/**
 * JWT helpers for 2FA challenge tokens.
 * Challenge tokens use dedicated config and include aud/iss claims for purpose binding.
 * These tokens CANNOT be used for API access and have strict expiration (5m).
 *
 * Security model:
 * - Challenge tokens have aud: "2fa_challenge" and iss: "acbu/auth"
 * - API session tokens have aud: "api_session" and are signed with a different (optional) secret
 * - Verification enforces audience to prevent token confusion
 */
import jwt from "jsonwebtoken";
import { config } from "../config/env";
import { logger } from "../config/logger";

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
  });
}

/**
 * Verify and decode a 2FA challenge token.
 * Enforces aud and iss claims to prevent token reuse.
 * Throws if invalid, expired, or used for wrong purpose.
 */
export function verifyChallengeToken(token: string): ChallengePayload {
  const secret = getChallengeSecret();

  try {
    const decoded = jwt.verify(token, secret, {
      audience: CHALLENGE_AUDIENCE,
      issuer: CHALLENGE_ISSUER,
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
