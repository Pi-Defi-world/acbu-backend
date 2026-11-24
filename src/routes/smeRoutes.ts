import { Router, type IRouter } from "express";
import { validateApiKey } from "../middleware/auth";
import { requireMinTier, requireSegmentScope } from "../middleware/segmentGuard";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";
import { postTransfers, getTransfers, getTransferById } from "../controllers/transferController";

const router: IRouter = Router();

router.use(validateApiKey);
router.use(requireMinTier("sme"));
router.use(requireSegmentScope("sme:read", "sme:write"));
router.use(apiKeyRateLimiter);

router.post("/transfers", postTransfers);
router.get("/transfers", getTransfers);
router.get("/transfers/:id", getTransferById);
router.get("/statements", getTransfers);

export default router;
