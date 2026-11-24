import { useMemo } from 'react';
import type { RequestOptions } from '@/lib/api/client';
export { useApiError } from '@/hooks/use-api-error';

/**
 * Returns RequestOptions for use with API modules.
 * Auth is via httpOnly cookie (set by backend on login).
 * Browser automatically includes it in all requests with credentials: 'include'.
 */
export function useApiOpts(): RequestOptions {
  return useMemo(() => ({}), []);
}
