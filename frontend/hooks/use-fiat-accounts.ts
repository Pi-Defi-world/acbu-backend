'use client';

import { useState, useEffect, useCallback } from 'react';
import { useApiOpts } from '@/hooks/use-api';
import { getFiatAccounts, type FiatAccount } from '@/lib/api/fiat';

interface UseFiatAccountsReturn {
  accounts: FiatAccount[];
  loading: boolean;
  error: string;
  /**
   * Triggers a re-fetch of fiat accounts.
   * `refetch` is preferred in UI; `refresh` kept for backwards-compat.
   */
  refetch: () => void;
  /** @deprecated Prefer `refetch()` */
  refresh: () => void;
}

/**
 * Fetches the authenticated user's simulated fiat bank accounts from
 * GET /fiat/accounts.
 *
 * Uses AbortController so that:
 * - In-flight requests are cancelled when the component unmounts
 * - Stale responses are ignored when deps (e.g. api key / token) change rapidly
 * - State is never updated after the owning effect has been cleaned up
 */
export function useFiatAccounts(): UseFiatAccountsReturn {
  const opts = useApiOpts();
  const [accounts, setAccounts] = useState<FiatAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  const refresh = refetch;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');

    getFiatAccounts({ ...opts, signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setAccounts(data.accounts ?? []);
      })
      .catch((e) => {
        // Ignore abort errors — expected on unmount / dep change
        if (controller.signal.aborted) return;
        if (e instanceof Error && e.name === 'AbortError') return;
        setAccounts([]);
        setError(e instanceof Error ? e.message : 'Failed to load fiat accounts');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
    };
    // opts.token covers auth/apiKey changes; tick covers manual refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally key on token, not whole opts object
  }, [opts.token, tick]);

  return { accounts, loading, error, refetch, refresh };
}
