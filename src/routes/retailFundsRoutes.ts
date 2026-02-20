/**
 * Audience-specific funds routes: retail (everyday users).
 * POST /v1/retail/mint/usdc, POST /v1/retail/mint/deposit, POST /v1/retail/burn/acbu
 * Delegates to shared mint/burn controllers with audience = 'retail'.
 */
import { Router, type IRouter } from 'express';
import { mintFromUsdc, depositFromBasketCurrency } from '../controllers/mintController';
import { burnAcbu } from '../controllers/burnController';
import { validateApiKey } from '../middleware/auth';
import { apiKeyRateLimiter } from '../middleware/rateLimiter';

const router: IRouter = Router();

router.use(validateApiKey);
router.use((req, _res, next) => {
  (req as import('../middleware/auth').AuthRequest).audience = 'retail';
  next();
});
router.use(apiKeyRateLimiter);

router.post('/mint/usdc', mintFromUsdc);
router.post('/mint/deposit', depositFromBasketCurrency);
router.post('/burn/acbu', burnAcbu);

export default router;
