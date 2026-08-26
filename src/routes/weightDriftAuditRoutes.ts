/**
 * Weight Drift Audit Routes
 *
 * Admin-only endpoints for weight drift audit management:
 * - GET /v1/admin/weight-drift-audits - List audits
 * - GET /v1/admin/weight-drift-audits/:id - Get audit details
 * - POST /v1/admin/weight-drift-audits - Create manual audit
 * - POST /v1/admin/weight-drift-audits/:id/approve - Approve audit
 * - POST /v1/admin/weight-drift-audits/:id/reject - Reject audit
 */

import { Router, type IRouter } from "express";
import {
  listWeightDriftAudits,
  getWeightDriftAudit,
  createWeightDriftAudit,
  approveWeightDriftAudit,
  rejectWeightDriftAudit,
} from "../controllers/weightDriftAuditController";
import { requireAdminApiKey } from "../middleware/adminAuth";
import { adminRateLimiter } from "../middleware/rateLimiter";

const router: IRouter = Router();

router.use(adminRateLimiter);
router.use(requireAdminApiKey);

// List audits with optional filtering
router.get("/", listWeightDriftAudits);

// Get single audit
router.get("/:id", getWeightDriftAudit);

// Create manual audit
router.post("/", createWeightDriftAudit);

// Approve pending audit
router.post("/:id/approve", approveWeightDriftAudit);

// Reject pending audit
router.post("/:id/reject", rejectWeightDriftAudit);

export default router;
