import { Router, type IRouter } from "express";
import { validateApiKey } from "../middleware/auth";
import { requireMinTier, requireSegmentScope } from "../middleware/segmentGuard";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";
import {
  postTransfers,
  getTransfers,
  getTransferById,
} from "../controllers/transferController";

const router: IRouter = Router();

router.use(validateApiKey);
router.use(requireMinTier("verified"));
router.use(requireSegmentScope("p2p:read", "p2p:write"));
router.use(apiKeyRateLimiter);

router.post("/send", postTransfers);
router.get("/history", getTransfers);
router.get("/:id", getTransferById);

export default router;
