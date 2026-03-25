import { Router, type IRouter } from "express";
import {
  handleFlutterwaveWebhook,
  verifyFlutterwaveSignature,
  handlePaystackWebhook,
  verifyPaystackSignature,
} from "../controllers/webhookController";

const router: IRouter = Router();
// Raw body and parsed body are set by middleware in index.ts for /v1/webhooks
router.post(
  "/flutterwave",
  verifyFlutterwaveSignature,
  handleFlutterwaveWebhook,
);
router.post("/paystack", verifyPaystackSignature, handlePaystackWebhook);

export default router;
