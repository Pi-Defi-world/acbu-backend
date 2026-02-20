/**
 * Audience-specific funds routes: business (SME/enterprise).
 * POST /v1/business/mint/usdc, POST /v1/business/mint/deposit, POST /v1/business/burn/acbu
 * Requires sme or enterprise segment scope; delegates to shared mint/burn with audience = 'business'.
 */
import { Router, type IRouter } from 'express';
import { mintFromUsdc, depositFromBasketCurrency } from '../controllers/mintController';
import { burnAcbu } from '../controllers/burnController';
import { validateApiKey } from '../middleware/auth';
import { requireSegmentScope } from '../middleware/segmentGuard';
import { apiKeyRateLimiter } from '../middleware/rateLimiter';

const router: IRouter = Router();

router.use(validateApiKey);
router.use(requireSegmentScope('sme:write', 'enterprise:write'));
router.use((req, _res, next) => {
  (req as import('../middleware/auth').AuthRequest).audience = 'business';
  next();
});
router.use(apiKeyRateLimiter);

router.post('/mint/usdc', mintFromUsdc);
router.post('/mint/deposit', depositFromBasketCurrency);
router.post('/burn/acbu', burnAcbu);

export default router;
