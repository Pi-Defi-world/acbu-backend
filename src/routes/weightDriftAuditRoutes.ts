/**
 * Weight Drift Audit Routes
 *
 * Admin-only endpoints for weight drift audit management:
 * - GET /v1/admin/weight-drift-audits        - List audits
 * - GET /v1/admin/weight-drift-audits/:id    - Get audit details
 * - POST /v1/admin/weight-drift-audits       - Create manual audit
 * - POST /v1/admin/weight-drift-audits/:id/approve - Approve audit
 * - POST /v1/admin/weight-drift-audits/:id/reject  - Reject audit
 *
 * Auth guard
 * ----------
 * These routes are protected by `requireAdminApiKey` from adminAuth, which
 * validates the `x-admin-key` header against the env-configured static
 * ADMIN_API_KEY(S).  This is intentionally different from `validateAdminKey`
 * in auth.ts, which validates DB-issued ADMIN_KEY / BREAK_GLASS_KEY records.
 * Weight-drift audit endpoints are called by internal operators and automated
 * jobs that hold static admin keys, not by end-user API key holders.
 *
 * W10-BE-001 fix
 * --------------
 * A prior version of this file imported `validateAdminKey` from
 * `../middleware/auth`, which caused a boot-time TypeError if that symbol was
 * absent (router.use(undefined)).  The guard has been corrected to
 * `requireAdminApiKey` from `../middleware/adminAuth` — a concrete, always-
 * defined function.  The import below is the single authoritative source of
 * the admin guard for this router; no fallback to auth.ts is needed.
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

// W10-BE-001: Fail fast at module load if the guard is undefined rather than
// mounting undefined middleware silently (which would leave routes unprotected).
if (typeof requireAdminApiKey !== "function") {
  throw new Error(
    "[weightDriftAuditRoutes] requireAdminApiKey is not a function — " +
      "check ../middleware/adminAuth exports",
  );
}

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
