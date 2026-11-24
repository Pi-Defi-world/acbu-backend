/**
 * Barrel export for /contexts
 *
 * All exports are named exports for consistent import style:
 *   import { useAuth, AuthProvider } from '@/contexts'
 */

export { AuthProvider, useAuth } from './auth-context';
export { I18nProvider, useI18n } from './i18n-context';
export { NavigationGuardProvider, useNavigationGuard } from './navigation-guard-context';
