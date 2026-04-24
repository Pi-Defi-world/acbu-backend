import { Router } from "express";
import {
  postSignup,
  postSignin,
  postSignout,
  postVerify2fa,
} from "../controllers/authController";
import { validateApiKey } from "../middleware/auth";
import {
  authRateLimiter,
  apiKeyRateLimiter,
} from "../middleware/rateLimiter";

const router: ReturnType<typeof Router> = Router();

router.post("/signup", authRateLimiter, postSignup);
router.post("/signin", authRateLimiter, postSignin);
router.post("/signin/verify-2fa", authRateLimiter, postVerify2fa);

// Signout requires API key
router.post("/signout", validateApiKey, apiKeyRateLimiter, postSignout);

export default router;
