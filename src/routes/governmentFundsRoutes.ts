/**
 * Audience-specific funds routes: government.
 * POST /v1/government/mint/usdc, POST /v1/government/mint/deposit, POST /v1/government/burn/acbu
 * Requires government segment scope; delegates to shared mint/burn with audience = 'government'.
 */
import { Router, type IRouter } from 'express';
import { mintFromUsdc, depositFromBasketCurrency } from '../controllers/mintController';
import { burnAcbu } from '../controllers/burnController';
import { getGovernmentTreasury, getGovernmentStatements } from '../controllers/governmentController';
import { validateApiKey } from '../middleware/auth';
import { requireSegmentScope } from '../middleware/segmentGuard';
import { apiKeyRateLimiter } from '../middleware/rateLimiter';

const router: IRouter = Router();

router.use(validateApiKey);
router.use(requireSegmentScope('government:read', 'government:write'));
router.use((req, _res, next) => {
  (req as import('../middleware/auth').AuthRequest).audience = 'government';
  next();
});
router.use(apiKeyRateLimiter);

router.post('/mint/usdc', mintFromUsdc);
router.post('/mint/deposit', depositFromBasketCurrency);
router.post('/burn/acbu', burnAcbu);
router.get('/treasury', getGovernmentTreasury);
router.get('/statements', getGovernmentStatements);

export default router;
