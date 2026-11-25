import { Router, type IRouter } from "express";
import { validateApiKey } from "../middleware/auth";
import { requireMinTier, requireSegmentScope } from "../middleware/segmentGuard";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";
import {
  postLendingDeposit,
  postLendingWithdraw,
  getLendingBalance,
  postLendingBorrow,
  postLendingRepay,
  postLendingLiquidate,
} from "../controllers/lendingController";

const router: IRouter = Router();

router.use(validateApiKey);
router.use(requireMinTier("verified"));
router.use(requireSegmentScope("lending:read", "lending:write"));
router.use(apiKeyRateLimiter);

router.post("/deposit", postLendingDeposit);
router.post("/withdraw", postLendingWithdraw);
router.get("/balance", getLendingBalance);
router.post("/borrow", postLendingBorrow);
router.post("/repay", postLendingRepay);
router.post("/liquidate", postLendingLiquidate);

export default router;
