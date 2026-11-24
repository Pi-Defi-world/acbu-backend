import { Router, type IRouter } from "express";
import { getReserveStatus, trackReserves } from "../controllers/reserveController";
import { validateApiKey } from "../middleware/auth";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";

const router: IRouter = Router();

// All reserve routes require API key authentication
router.use(validateApiKey);
router.use(apiKeyRateLimiter);

router.get("/", getReserveStatus);
router.post("/track", trackReserves);

export default router;
