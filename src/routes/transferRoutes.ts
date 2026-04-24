import { Router, type IRouter } from "express";
import {
  postTransfers,
  getTransfers,
  getTransferById,
} from "../controllers/transferController";
import { validateApiKey } from "../middleware/auth";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";

/**
 * @swagger
 * tags:
 *   - name: Transfers
 *     description: ACBU transfer operations between users
 */

/**
 * @swagger
 * /v1/transfers:
 *   post:
 *     tags:
 *       - Transfers
 *     summary: Create a new ACBU transfer
 *     description: Transfer ACBU from current user to recipient (by alias or Stellar address)
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *               - amount_acbu
 *             properties:
 *               to:
 *                 type: string
 *                 minLength: 1
 *                 description: Recipient alias (@user, E.164 phone, email) or Stellar address (56 chars)
 *               amount_acbu:
 *                 type: string
 *                 pattern: '^\d+(\.\d{1,7})?$'
 *                 description: Amount in ACBU (positive number with up to 7 decimals)
 *               blockchain_tx_hash:
 *                 type: string
 *                 pattern: '^[a-fA-F0-9]{64}$'
 *                 description: Optional blockchain transaction hash (64-char hex)
 *     responses:
 *       201:
 *         description: Transfer created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transaction_id:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                   enum: [pending, completed, failed]
 *       400:
 *         description: Invalid input or insufficient balance
 *       401:
 *         description: User-scoped API key required
 *   get:
 *     tags:
 *       - Transfers
 *     summary: List user's transfers
 *     description: Get paginated list of current user's transfers with cursor-based pagination
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           minimum: 1
 *           maximum: 100
 *         description: Number of results per page
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Cursor for next page (from previous response)
 *     responses:
 *       200:
 *         description: List of transfers retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transfers:
 *                   type: array
 *                   items:
 *                     type: object
 *                 next_cursor:
 *                   type: string
 *       401:
 *         description: User-scoped API key required
 */

/**
 * @swagger
 * /v1/transfers/{id}:
 *   get:
 *     tags:
 *       - Transfers
 *     summary: Get transfer by ID
 *     description: Retrieve details of a specific transfer transaction
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Transfer transaction ID
 *     responses:
 *       200:
 *         description: Transfer details retrieved
 *       401:
 *         description: User-scoped API key required
 *       404:
 *         description: Transfer not found
 */

const router: IRouter = Router();

router.use(validateApiKey);
router.use(apiKeyRateLimiter);

router.post("/", postTransfers);
router.get("/", getTransfers);
router.get("/:id", getTransferById);

export default router;
