import { Router } from "express";
import {
  postUnlock,
  postUnlockVerify,
} from "../controllers/recoveryController";
import { standardRateLimiter } from "../middleware/rateLimiter";

const router: ReturnType<typeof Router> = Router();

router.use(standardRateLimiter);

router.post("/unlock", postUnlock);
router.post("/unlock/verify", postUnlockVerify);

export default router;
