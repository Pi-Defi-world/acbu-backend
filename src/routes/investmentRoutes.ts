import { Router, type IRouter } from "express";
import { validateApiKey } from "../middleware/auth";
import { requireMinTier, requireSegmentScope } from "../middleware/segmentGuard";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";
import {
  postInvestmentWithdrawRequest,
  getInvestmentWithdrawRequests,
} from "../controllers/investmentController";

const router: IRouter = Router();

router.use(validateApiKey);
router.use(requireMinTier("verified"));
router.use(requireSegmentScope("investment:read", "investment:write"));
router.use(apiKeyRateLimiter);

router.post("/withdraw/request", postInvestmentWithdrawRequest);
router.get("/withdraw/requests", getInvestmentWithdrawRequests);

export default router;
