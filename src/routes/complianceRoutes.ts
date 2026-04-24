import { Router } from "express";
import { exportData, deleteAccount } from "../controllers/complianceController";
import { validateApiKey } from "../middleware/auth";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";

const router: ReturnType<typeof Router> = Router();

// All compliance endpoints require an authenticated user
router.use(validateApiKey);
router.use(apiKeyRateLimiter);

router.get("/export", exportData);
router.delete("/account", deleteAccount);

export default router;
