import { Router, type IRouter } from "express";
import {
  mintFromUsdc,
  depositFromBasketCurrency,
  verifyMintConfirmationSignature,
  confirmMint,
} from "../controllers/mintController";
import { validateApiKey } from "../middleware/auth";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";

export function createMintRoutes(): ReturnType<typeof Router> {
  const router: IRouter = Router();

  /**
   * @swagger
   * tags:
   *   - name: Mint
   *     description: Asset minting and deposits
   */

  // ── User-facing endpoints (require API key + rate limiter) ─────────────────

  /**
   * @swagger
   * /v1/mint/usdc:
   *   post:
   *     tags:
   *       - Mint
   *     summary: Mint ACBU from USDC
   *     description: Accept USDC deposit, convert to XLM in backend, and mint ACBU.
   *     security:
   *       - ApiKeyAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - usdc_amount
   *               - wallet_address
   *             properties:
   *               usdc_amount:
   *                 type: string
   *               wallet_address:
   *                 type: string
   *               currency_preference:
   *                 type: string
   *                 enum: [auto]
   *     responses:
   *       202:
   *         description: Mint request accepted
   */
  router.post("/usdc", validateApiKey, apiKeyRateLimiter, mintFromUsdc);

  /**
   * @swagger
   * /v1/mint/deposit:
   *   post:
   *     tags:
   *       - Mint
   *     summary: Deposit basket currency to mint ACBU
   *     description: Deposit local currency (NGN, KES, etc.) to mint ACBU.
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
   *               - wallet_address
   *             properties:
   *               currency:
   *                 type: string
   *                 minLength: 3
   *                 maxLength: 3
   *               amount:
   *                 type: string
   *               wallet_address:
   *                 type: string
   *               fintech_tx_id:
   *                 type: string
   *                 description: Optional external payment transaction ID used for idempotency and duplicate detection
   *     responses:
   *       202:
   *         description: Deposit request accepted
   */
  router.post("/deposit", validateApiKey, apiKeyRateLimiter, depositFromBasketCurrency);

  // ── Partner server-to-server endpoint (HMAC-signed, no API key) ────────────

  /**
   * @swagger
   * /v1/mint/confirm:
   *   post:
   *     tags:
   *       - Mint
   *     summary: Authoritative partner mint-confirmation (W10-SEC-017)
   *     description: |
   *       Called by a trusted partner after a basket-currency deposit has settled.
   *       The request body MUST be HMAC-SHA256 signed with MINT_CONFIRMATION_SECRET
   *       via the `x-mint-signature` header. A `x-mint-timestamp` (Unix seconds)
   *       header is required and must be within ±5 minutes of server time (replay
   *       protection).
   *
   *       This is the **authoritative** gate for on-chain minting of basket deposits.
   *       The deprecated Flutterwave/Paystack webhook paths are audit-only and do
   *       NOT trigger minting.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - transaction_id
   *               - partner_reference
   *               - amount
   *               - currency
   *               - confirmed_at
   *             properties:
   *               transaction_id:
   *                 type: string
   *                 description: The pending Transaction.id from /v1/mint/deposit
   *               partner_reference:
   *                 type: string
   *                 description: Partner-assigned settlement reference (for audit)
   *               amount:
   *                 type: string
   *                 description: Confirmed settled amount in local currency
   *               currency:
   *                 type: string
   *                 minLength: 3
   *                 maxLength: 3
   *               confirmed_at:
   *                 type: integer
   *                 description: Unix timestamp (seconds) of partner settlement
   *     responses:
   *       200:
   *         description: Mint confirmed and ACBU issued on-chain
   *       401:
   *         description: Missing or invalid HMAC signature / expired timestamp
   *       404:
   *         description: Transaction not found
   *       409:
   *         description: Transaction is not in a confirmable state
   *       503:
   *         description: Minting paused or secret not configured
   */
  router.post("/confirm", verifyMintConfirmationSignature, confirmMint);

  return router;
}

const router = createMintRoutes();
export default router;
