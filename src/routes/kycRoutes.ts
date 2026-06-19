import { Router, type IRouter } from "express";
import { validateApiKey } from "../middleware/auth";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";
import {
  postCreateApplication,
  getMyApplications,
  getApplicationById,
  patchDocuments,
  getUploadUrl,
  postRegisterValidator,
  getMyValidatorTasks,
  postValidatorResult,
  getValidatorMe,
  getValidatorDashboard,
} from "../controllers/kycController";

const router: IRouter = Router();

router.use(validateApiKey);
router.use(apiKeyRateLimiter);

// User endpoints
router.post("/applications", postCreateApplication);
router.get("/applications", getMyApplications);
router.get("/applications/upload-urls", getUploadUrl);
router.get("/applications/:id", getApplicationById);
router.patch("/applications/:id/documents", patchDocuments);

// Validator endpoints
router.post("/validator/register", postRegisterValidator);
router.get("/validator/tasks", getMyValidatorTasks);
router.get("/validator/dashboard", getValidatorDashboard);
router.post("/validator/tasks/:taskId", postValidatorResult);
router.get("/validator/me", getValidatorMe);

export default router;
