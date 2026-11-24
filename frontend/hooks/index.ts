/**
 * Barrel export for /hooks
 *
 * All exports are named exports for consistent import style:
 *   import { useAuth, useBalance } from '@/hooks'
 */

export { useApiOpts } from './use-api';
export { mapApiError, useApiError } from './use-api-error';
export { useBalance } from './use-balance';
export { useDebounce } from './use-debounce';
export { useFiatAccounts } from './use-fiat-accounts';
export { useHaptic, HapticPattern } from './use-haptic';
export { useIsMobile } from './use-mobile';
export { useNavigationGuard } from './use-navigation-guard';
export { useOnlineStatus } from './use-online-status';
export { useScrollRestoration } from './use-scroll-restoration';
export { useSessionGuard } from './use-session-guard';
export { useToast, toast } from './use-toast';
