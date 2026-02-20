import { Router, type IRouter } from 'express';
import { validateApiKey } from '../middleware/auth';
import { requireSegmentScope } from '../middleware/segmentGuard';
import { apiKeyRateLimiter } from '../middleware/rateLimiter';
import {
  postSavingsDeposit,
  postSavingsWithdraw,
  getSavingsPositions,
  getNextWithdrawalDate,
} from '../controllers/savingsController';

const router: IRouter = Router();

router.use(validateApiKey);
router.use(requireSegmentScope('savings:read', 'savings:write'));
router.use(apiKeyRateLimiter);

router.post('/deposit', postSavingsDeposit);
router.post('/withdraw', postSavingsWithdraw);
router.get('/positions', getSavingsPositions);
router.get('/next-withdrawal-date', getNextWithdrawalDate);

export default router;
