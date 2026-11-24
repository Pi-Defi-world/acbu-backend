import { Router } from "express";
import type { Response, NextFunction } from "express";
import {
  getPrivilegedKeys,
  postAdminMfaChallenge,
  postIssueAdminKey,
  postIssueBreakGlassKey,
  postRevokePrivilegedKey,
  postRefreshAccessToken,
  postRevokeRefreshToken,
  postSignup,
  postSignin,
  postSignout,
  postVerify2fa,
} from "../controllers/authController";
import { validateApiKey } from "../middleware/auth";
import type { AuthRequest } from "../middleware/auth";
import { requireAdminKeyType } from "../middleware/segmentGuard";
import { authRateLimiter, apiKeyRateLimiter, twoFaRateLimiter } from "../middleware/rateLimiter";

/**
 * @swagger
 * tags:
 *   - name: Authentication
 *     description: User authentication and session management
 */

/**
 * @swagger
 * /v1/auth/signup:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Create a new user account
 *     description: Register a new user with username and passcode. No email required.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - passcode
 *             properties:
 *               username:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 64
 *                 description: Unique username
 *               passcode:
 *                 type: string
 *                 minLength: 4
 *                 maxLength: 64
 *                 description: User's passcode (minimum 4 characters)
 *     responses:
 *       201:
 *         description: Account created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: string
 *                   format: uuid
 *                 message:
 *                   type: string
 *       400:
 *         description: Invalid input or username already taken
 *       409:
 *         description: Username already taken
 */

/**
 * @swagger
 * /v1/auth/signin:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: User login
 *     description: Authenticate user with identifier (username/email/phone) and passcode. May require 2FA verification.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - identifier
 *               - passcode
 *             properties:
 *               identifier:
 *                 type: string
 *                 minLength: 1
 *                 description: Username, email, or E.164 phone number
 *                 example: "@alice"
 *               passcode:
 *                 type: string
 *                 minLength: 1
 *                 description: User's passcode
 *               captcha_token:
 *                 type: string
 *                 description: Optional CAPTCHA token required when the auth service requests bot verification
 *     responses:
 *       200:
 *         description: Authentication successful or 2FA required
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   description: Successful login response
 *                   properties:
 *                     api_key:
 *                       type: string
 *                     user_id:
 *                       type: string
 *                       format: uuid
 *                     stellar_address:
 *                       type: string
 *                     wallet_enrollment_required:
 *                       type: boolean
 *                       description: True when the client must generate and enroll its own keypair
 *                 - type: object
 *                   description: 2FA required
 *                   properties:
 *                     requires_2fa:
 *                       type: boolean
 *                       enum: [true]
 *                     challenge_token:
 *                       type: string
 *       401:
 *         description: Invalid credentials
 *       400:
 *         description: 2FA channel not configured
 *       503:
 *         description: OTP delivery unavailable
 */

/**
 * @swagger
 * /v1/auth/signin/verify-2fa:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Verify 2FA code
 *     description: Complete 2FA challenge during login with OTP code
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - challenge_token
 *               - code
 *             properties:
 *               challenge_token:
 *                 type: string
 *                 minLength: 1
 *                 description: Challenge token from signin response
 *               code:
 *                 type: string
 *                 minLength: 1
 *                 description: OTP code from 2FA method
 *     responses:
 *       200:
 *         description: 2FA verification successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 api_key:
 *                   type: string
 *                 user_id:
 *                   type: string
 *                   format: uuid
 *                 stellar_address:
 *                   type: string
 *       401:
 *         description: Invalid or expired challenge/code
 *       400:
 *         description: TOTP not configured or unsupported 2FA method
 */

/**
 * @swagger
 * /v1/auth/signout:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: User logout
 *     description: Revoke the current API key and end the session
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *       401:
 *         description: API key required
 */

const router: ReturnType<typeof Router> = Router();

function normalizeRateLimitIdentifier(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  if (trimmed.includes("@") && trimmed.includes(".")) {
    return trimmed.toLowerCase();
  }

  if (trimmed.startsWith("+") && /^\+[0-9]{10,15}$/.test(trimmed)) {
    return trimmed;
  }

  return trimmed.toLowerCase().replace(/\s/g, "");
}

function normalizeAuthRateLimitBody(req: AuthRequest, _res: Response, next: NextFunction): void {
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (typeof body.identifier === "string") {
    body.identifier = normalizeRateLimitIdentifier(body.identifier);
  }

  if (typeof body.email === "string") {
    body.email = normalizeRateLimitIdentifier(body.email);
  }

  next();
}

router.post("/signup", authRateLimiter, postSignup);
// #269: twoFaRateLimiter adds per-user/IP keyed limiting on top of the IP-only authRateLimiter
// #391: normalize identifier/email before the per-user limiter so case variants share one budget
router.post("/signin", authRateLimiter, normalizeAuthRateLimitBody, twoFaRateLimiter, postSignin);
router.post(
  "/signin/verify-2fa",
  authRateLimiter,
  normalizeAuthRateLimitBody,
  twoFaRateLimiter,
  postVerify2fa,
);

// Signout requires API key
router.post("/signout", validateApiKey, apiKeyRateLimiter, postSignout);

// Privileged key lifecycle requires authenticated user + MFA challenge verification.
// W10-BE-005: key management (listing/revoking admin material) additionally requires an
// admin-capable key type, so an admin-tier *account* session alone cannot enumerate or
// revoke privileged keys. Issuance endpoints keep the tier + MFA path (no key-type guard)
// because they are how the first admin/break-glass key is bootstrapped from a USER_KEY.
router.post("/admin/challenge", validateApiKey, apiKeyRateLimiter, postAdminMfaChallenge);
router.post("/keys/admin", validateApiKey, apiKeyRateLimiter, postIssueAdminKey);
router.post("/keys/break-glass", validateApiKey, apiKeyRateLimiter, postIssueBreakGlassKey);
router.get(
  "/keys/privileged",
  validateApiKey,
  requireAdminKeyType(),
  apiKeyRateLimiter,
  getPrivilegedKeys,
);
router.post(
  "/keys/:id/revoke",
  validateApiKey,
  requireAdminKeyType(),
  apiKeyRateLimiter,
  postRevokePrivilegedKey,
);

// Refresh token endpoints
router.post("/refresh-token", authRateLimiter, postRefreshAccessToken);
router.post("/refresh-token/revoke", authRateLimiter, postRevokeRefreshToken);

export default router;
