import { Router, type IRouter } from "express";
import { validateApiKey } from "../middleware/auth";
import { requireSegmentScope } from "../middleware/segmentGuard";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";
import {
  getBillsCatalog,
  postBillsPay,
  postBillsRefund,
} from "../controllers/billsController";

const router: IRouter = Router();

router.use(validateApiKey);
router.use(apiKeyRateLimiter);

router.get(
  "/catalog",
  requireSegmentScope("bills:read", "bills:write"),
  getBillsCatalog,
);
router.post("/pay", requireSegmentScope("bills:write"), postBillsPay);
router.post("/refund", requireSegmentScope("bills:write"), postBillsRefund);

export default router;
