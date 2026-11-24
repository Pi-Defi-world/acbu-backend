'use client';

import { useState, useEffect, useCallback } from 'react';
import { useApiOpts } from '@/hooks/use-api';
import * as userApi from '@/lib/api/user';

interface UseBalanceReturn {
  balance: number | null;
  /** When Soroban mint fails, backend may surface DB ledger while Horizon is 0. */
  balanceSource?: string;
  loading: boolean;
  error: string;
  /** Triggers a re-fetch of the balance. */
  refetch: () => void;
}

/**
 * Fetches the authenticated user's ACBU wallet balance from GET /users/me/balance.
 * Returns a numeric balance (null while unknown), loading flag, error string, and refresh fn.
 */
export function useBalance(): UseBalanceReturn {
  const opts = useApiOpts();
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceSource, setBalanceSource] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  // Auto-refresh balance every 30 seconds to catch external transactions.
  // No stale closure risk: `interval` is captured in the same effect scope, so
  // the cleanup always clears the correct interval ID. `refresh` is stable
  // (useCallback with no deps) because setTick uses a functional updater.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const startInterval = () => {
      if (interval !== null) return; // already running
      interval = setInterval(() => refetch(), 30_000);
    };

    const stopInterval = () => {
      if (interval === null) return;
      clearInterval(interval);
      interval = null;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refetch();      // immediate refresh on tab focus
        startInterval();
      } else {
        stopInterval(); // pause while hidden
      }
    };

    // Only start the interval if the tab is already visible on mount.
    if (document.visibilityState === 'visible') {
      startInterval();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopInterval();
    };
  }, [refetch]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    userApi
      .getBalance({ ...opts, priority: 'high' })
      .then((data) => {
        if (cancelled) return;
        const raw = data.balance;
        const num = typeof raw === 'number' ? raw : parseFloat(raw);
        setBalance(Number.isNaN(num) ? null : num);
        setBalanceSource(data.balance_source);
      })
      .catch((e) => {
        if (cancelled) return;
        setBalance(null);
        setBalanceSource(undefined);
        setError(e instanceof Error ? e.message : 'Failed to load balance');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [opts.token, tick]);

  return { balance, balanceSource, loading, error, refetch };
}
