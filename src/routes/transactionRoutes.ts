import { Router, type IRouter } from "express";
import { getTransactionById, listMyTransactions } from "../controllers/transactionController";
import { validateApiKey } from "../middleware/auth";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";

const router: IRouter = Router();
router.use(validateApiKey);
router.use(apiKeyRateLimiter);
/**
 * @swagger
 * tags:
 *   - name: Transactions
 *     description: Transaction history and status tracking
 */

/**
 * @swagger
 * /v1/transactions:
 *   get:
 *     tags:
 *       - Transactions
 *     summary: List user transactions
 *     description: Retrieve a paginated list of the current user's transactions (mint, burn, transfer).
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: string
 *           default: "20"
 *         description: Number of transactions to return (1-100)
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Transaction ID to use as a starting point for pagination
 *     responses:
 *       200:
 *         description: List of transactions retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/", listMyTransactions);

/**
 * @swagger
 * /v1/transactions/{id}:
 *   get:
 *     tags:
 *       - Transactions
 *     summary: Get transaction details
 *     description: Retrieve detailed information about a specific transaction by its ID.
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Unique transaction ID
 *     responses:
 *       200:
 *         description: Transaction details retrieved successfully
 *       404:
 *         description: Transaction not found
 */
router.get("/:id", getTransactionById);
export default router;
