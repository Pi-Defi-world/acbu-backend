import { Router, type IRouter } from "express";
import { validateApiKey } from "../middleware/auth";
import { requireMinTier, requireSegmentScope } from "../middleware/segmentGuard";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";
import {
  postSalaryDisburse,
  getSalaryBatches,
  postSalarySchedule,
  getSalarySchedules,
} from "../controllers/salaryController";

const router: IRouter = Router();

router.use(validateApiKey);
router.use(requireMinTier("sme"));
router.use(requireSegmentScope("salary:read", "salary:write"));
router.use(apiKeyRateLimiter);

/**
 * @swagger
 * tags:
 *   - name: Salary
 *     description: Batch salary disbursement and scheduling
 */

/**
 * @swagger
 * /v1/salary/disburse:
 *   post:
 *     tags:
 *       - Salary
 *     summary: Batch salary disbursement
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - items
 *             properties:
 *               organization_id:
 *                 type: string
 *                 format: uuid
 *               total_amount:
 *                 type: string
 *               currency:
 *                 type: string
 *                 default: "ACBU"
 *               idempotency_key:
 *                 type: string
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - recipient_address
 *                     - amount
 *                   properties:
 *                     recipient_id:
 *                       type: string
 *                       format: uuid
 *                     recipient_address:
 *                       type: string
 *                     amount:
 *                       type: string
 *     responses:
 *       202:
 *         description: Salary batch accepted
 */
router.post("/disburse", postSalaryDisburse);

/**
 * @swagger
 * /v1/salary/schedule:
 *   post:
 *     tags:
 *       - Salary
 *     summary: Schedule recurring salary payments
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - cron
 *               - amount_config
 *             properties:
 *               organization_id:
 *                 type: string
 *                 format: uuid
 *               name:
 *                 type: string
 *               cron:
 *                 type: string
 *               currency:
 *                 type: string
 *                 default: "ACBU"
 *               amount_config:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - recipient_address
 *                     - amount
 *                   properties:
 *                     recipient_id:
 *                       type: string
 *                       format: uuid
 *                     recipient_address:
 *                       type: string
 *                     amount:
 *                       type: string
 *     responses:
 *       201:
 *         description: Salary schedule created
 */
router.post("/schedule", postSalarySchedule);

/**
 * @swagger
 * /v1/salary/batches:
 *   get:
 *     tags:
 *       - Salary
 *     summary: List salary batches
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         description: Maximum number of batches to return (1-100)
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *       - in: query
 *         name: offset
 *         description: Number of batches to skip
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *     responses:
 *       200:
 *         description: Paginated list of salary batches
 */
router.get("/batches", getSalaryBatches);

/**
 * @swagger
 * /v1/salary/schedules:
 *   get:
 *     tags:
 *       - Salary
 *     summary: List salary schedules
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         description: Maximum number of schedules to return (1-100)
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *       - in: query
 *         name: offset
 *         description: Number of schedules to skip
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *     responses:
 *       200:
 *         description: Paginated list of salary schedules
 */
router.get("/schedules", getSalarySchedules);

export default router;
