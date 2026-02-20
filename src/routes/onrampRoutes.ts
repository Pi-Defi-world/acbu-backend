import { Router, type IRouter } from 'express';
import { registerOnRampSwap } from '../controllers/onrampController';
import { validateApiKey } from '../middleware/auth';
import { apiKeyRateLimiter } from '../middleware/rateLimiter';

const router: IRouter = Router();
router.use(validateApiKey);
router.use(apiKeyRateLimiter);
router.post('/register', registerOnRampSwap);
export default router;
