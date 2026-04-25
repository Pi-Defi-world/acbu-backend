import { Router } from "express";
import {
  postSignup,
  postSignin,
  postSignout,
  postVerify2fa,
} from "../controllers/authController";
import { validateApiKey } from "../middleware/auth";
import {
  standardRateLimiter,
  apiKeyRateLimiter,
} from "../middleware/rateLimiter";

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
 *               passcode:
 *                 type: string
 *                 minLength: 1
 *                 description: User's passcode
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
 *                     wallet_created:
 *                       type: boolean
 *                     passphrase:
 *                       type: string
 *                     encryption_method_required:
 *                       type: boolean
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

router.use(standardRateLimiter);

router.post("/signup", postSignup);
router.post("/signin", postSignin);
router.post("/signin/verify-2fa", postVerify2fa);

// Signout requires API key
router.post("/signout", validateApiKey, apiKeyRateLimiter, postSignout);

export default router;
