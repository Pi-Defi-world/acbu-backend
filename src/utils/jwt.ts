/**
 * JWT helpers for 2FA challenge tokens.
 * Challenge tokens use dedicated config and include aud/iss claims for purpose binding.
 * These tokens CANNOT be used for API access and have strict expiration (5m).
 *
 * Security model:
 * - Challenge tokens have aud: "2fa_challenge" and iss: "acbu/auth"
 * - API session tokens have aud: "api_session" and are signed with a different (optional) secret
 * - Verification enforces audience to prevent token confusion
 * - jti (JWT ID) uniqueness is enforced via a deny-list shared through Redis
 *   (#288, #984), so a stolen token replayed within its 5-minute window is
 *   rejected even when the replay lands on a different instance.
 */
import jwt from "jsonwebtoken";
import { config } from "../config/env";
import { logger } from "../config/logger";
import { EXPECTED_JWT_TYP, verifyJwt } from "../middleware/authMiddleware";
import { consumeJti, isJtiRevoked, revokeJti } from "./jtiDenyList";

// ---------------------------------------------------------------------------
// JTI deny-list — fixes #288; shared across instances via Redis (#984).
// `consumeJti` performs an atomic SET NX so concurrent replays cannot both win.
// ---------------------------------------------------------------------------
export { consumeJti, isJtiRevoked, revokeJti };

const CHALLENGE_EXPIRY = "5m";
const CHALLENGE_AUDIENCE = "2fa_challenge";
const CHALLENGE_ISSUER = "acbu/auth";

export interface ChallengePayload {
  userId: string;
  otpChallengeId?: string;
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
export function signChallengeToken(
  userId: string,
  options: { otpChallengeId?: string } = {},
): string {
  const secret = getChallengeSecret();

  const payload: ChallengePayload = {
    userId,
    ...(options.otpChallengeId ? { otpChallengeId: options.otpChallengeId } : {}),
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
export async function verifyChallengeToken(
  token: string,
  options: { consumeJti?: boolean } = {},
): Promise<ChallengePayload> {
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

    // jti replay check — #288 (in-process) / #984 (shared across instances).
    // `consumeJti` is an atomic SET NX, so exactly one of several racing
    // instances observes `firstUse === true`.
    if (decoded.jti) {
      const exp = decoded.exp ?? Math.floor(Date.now() / 1000) + 300;
      const firstUse =
        options.consumeJti === false
          ? !(await isJtiRevoked(decoded.jti))
          : await consumeJti(decoded.jti, exp);

      if (!firstUse) {
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
