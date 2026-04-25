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

router.post("/disburse", postSalaryDisburse);
router.post("/schedule", postSalarySchedule);
router.get("/batches", getSalaryBatches);
router.get("/schedules", getSalarySchedules);

export default router;
