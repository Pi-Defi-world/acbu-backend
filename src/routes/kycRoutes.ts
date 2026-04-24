import { Router } from "express";
import {
  requestUploadUrl,
  confirmUpload,
  requestDownloadUrl,
  scanWebhook,
} from "../controllers/kycController";
import { validateApiKey } from "../middleware/auth";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";

const router: ReturnType<typeof Router> = Router();

/**
 * POST /kyc/scan-webhook
 * Virus-scanner callback — HMAC-verified, no user auth required.
 * Mounted BEFORE validateApiKey so the scanner service doesn't need an API key.
 */
router.post("/scan-webhook", scanWebhook);

// All remaining KYC document endpoints require a valid user API key
router.use(validateApiKey);
router.use(apiKeyRateLimiter);

/**
 * POST /kyc/documents/upload-url
 * Request a presigned S3 PUT URL for a KYC document.
 */
router.post("/documents/upload-url", requestUploadUrl);

/**
 * POST /kyc/documents/:id/confirm
 * Confirm a completed upload and record checksum + file size.
 */
router.post("/documents/:id/confirm", confirmUpload);

/**
 * GET /kyc/documents/:id/download-url
 * Request a presigned S3 GET URL (blocked until virus scan passes).
 */
router.get("/documents/:id/download-url", requestDownloadUrl);

export default router;
