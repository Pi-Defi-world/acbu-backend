import { Router, type IRouter } from "express";
import { validateApiKey } from "../middleware/auth";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";
import {
  createWebhookEndpoint,
  listWebhookEndpoints,
  deleteWebhookEndpoint,
} from "../controllers/webhookEndpointController";

const router: IRouter = Router();

router.use(validateApiKey);
router.use(apiKeyRateLimiter);
router.post("/endpoints", createWebhookEndpoint);
router.get("/endpoints", listWebhookEndpoints);
router.delete("/endpoints/:id", deleteWebhookEndpoint);

export default router;
