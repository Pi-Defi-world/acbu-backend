import { Router, type IRouter } from "express";
import { validateApiKey } from "../middleware/auth";
import { requireMinTier, requireSegmentScope } from "../middleware/segmentGuard";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";
import {
  postGatewayCharge,
  postGatewayConfirm,
} from "../controllers/gatewayController";

const router: IRouter = Router();

router.use(validateApiKey);
router.use(requireMinTier("sme"));
router.use(requireSegmentScope("gateway:read", "gateway:write"));
router.use(apiKeyRateLimiter);

router.post("/charges", postGatewayCharge);
router.post("/confirm", postGatewayConfirm);

export default router;
