import { Router } from "express";
import { validateApiKey } from "../middleware/auth";
import { postFaucet, getAccounts, postOnRamp, postOffRamp } from "../controllers/fiatController";

const router: Router = Router();

router.use(validateApiKey);

/**
 * @swagger
 * tags:
 *   - name: Fiat
 *     description: Fiat currency operations (on-ramp, off-ramp, faucet)
 */

/**
 * @swagger
 * /v1/fiat/faucet:
 *   post:
 *     tags:
 *       - Fiat
 *     summary: Request test currency from faucet
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currency
 *               - amount
 *             properties:
 *               currency:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 3
 *               amount:
 *                 type: number
 *               recipient:
 *                 type: string
 *     responses:
 *       200:
 *         description: Faucet request successful
 */
router.post("/faucet", postFaucet);

/**
 * @swagger
 * /v1/fiat/onramp:
 *   post:
 *     tags:
 *       - Fiat
 *     summary: Simulate on-ramp (Fiat -> ACBU)
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currency
 *               - amount
 *             properties:
 *               currency:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 3
 *               amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: On-ramp simulation successful
 */
router.post("/onramp", postOnRamp);

/**
 * @swagger
 * /v1/fiat/offramp:
 *   post:
 *     tags:
 *       - Fiat
 *     summary: Simulate off-ramp (ACBU -> Fiat)
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currency
 *               - amount
 *             properties:
 *               currency:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 3
 *               amount:
 *                 type: number
 *               blockchain_tx_hash:
 *                 type: string
 *     responses:
 *       200:
 *         description: Off-ramp simulation successful
 */
router.post("/offramp", postOffRamp);

/**
 * @swagger
 * /v1/fiat/accounts:
 *   get:
 *     tags:
 *       - Fiat
 *     summary: List fiat accounts
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Accounts retrieved successfully
 */
router.get("/accounts", getAccounts);

export default router;
