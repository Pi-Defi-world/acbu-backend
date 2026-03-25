import { Router, type IRouter } from "express";
import { validateApiKey } from "../middleware/auth";
import { requireSegmentScope } from "../middleware/segmentGuard";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";
import { validate } from "../middleware/validator";
import {
  savingsDepositSchema,
  savingsWithdrawSchema,
  savingsPositionsSchema,
} from "../validators/savingsValidator";
import {
  postSavingsDeposit,
  postSavingsWithdraw,
  getSavingsPositions,
  getNextWithdrawalDate,
} from "../controllers/savingsController";

const router: IRouter = Router();

router.use(validateApiKey);
router.use(requireSegmentScope("savings:read", "savings:write"));
router.use(apiKeyRateLimiter);

router.post("/deposit", validate(savingsDepositSchema), postSavingsDeposit);
router.post("/withdraw", validate(savingsWithdrawSchema), postSavingsWithdraw);
router.get("/positions", validate(savingsPositionsSchema), getSavingsPositions);
router.get("/next-withdrawal-date", getNextWithdrawalDate);

export default router;
