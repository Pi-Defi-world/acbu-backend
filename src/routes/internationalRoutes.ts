import { Router, type IRouter } from "express";
import { validateApiKey } from "../middleware/auth";
import { requireMinTier, requireSegmentScope } from "../middleware/segmentGuard";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";
import { getRates } from "../controllers/ratesController";
import mintRoutes from "./mintRoutes";
import burnRoutes from "./burnRoutes";

const router: IRouter = Router();

router.use(validateApiKey);
router.use(requireMinTier("verified"));
router.use(requireSegmentScope("international:read", "international:write"));
router.use(apiKeyRateLimiter);

router.get("/quote", getRates);
router.use("/mint", mintRoutes);
router.use("/burn", burnRoutes);

export default router;
