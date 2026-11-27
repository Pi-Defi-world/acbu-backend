'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  getAssetsConfig,
  clearAssetsConfigCache,
  type PublicAssetsConfig,
} from '@/lib/api/config';
/**
 * Stale-while-revalidate cache for app configuration.
 *
 * The assets config (network, issuer, contract addresses) changes very
 * rarely — at most on a new deploy. A 5-minute staleTime avoids
 * redundant fetches when components remount.
 *
 * This wraps the existing module-level cache in `lib/api/config.ts`
 * and adds proper staleness tracking with a React-friendly interface.
 */
const STALE_TIME = 5 * 60 * 1000; // 5 minutes
let cachedAt = 0;

export function clearConfigCache(): void {
  cachedAt = 0;
  clearAssetsConfigCache();
}

function isFresh(): boolean {
  return cachedAt > 0 && Date.now() - cachedAt < STALE_TIME;
}
interface UseConfigReturn {
  config: PublicAssetsConfig | null;
  loading: boolean;
  error: string;
  refresh: () => void;
}
/**
 * Fetches public assets configuration with a 5-minute stale-while-revalidate cache.
 *
 * - On mount: returns cached data instantly if fresh, otherwise fetches.
 * - `refresh()`: clears both caches and forces a network fetch.
 * - Leverages the existing module-level dedup in `lib/api/config.ts`.
 */
export function useConfig(): UseConfigReturn {
  const [config, setConfig] = useState<PublicAssetsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => {
    clearAssetsConfigCache();
    cachedAt = 0;
    setTick((t) => t + 1);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    // getAssetsConfig() deduplicates in-flight requests and caches the result
    // at module level. We pass our AbortSignal so the underlying fetch is
    // cancelled if the component unmounts before the response arrives.
    if (isFresh() && tick === 0) {
      // Cache is fresh — still call getAssetsConfig to get the cached value
      getAssetsConfig({ signal: controller.signal })
        .then((cfg) => {
          if (!controller.signal.aborted) {
            setConfig(cfg);
            setLoading(false);
          }
        })
        .catch(() => {
          // Shouldn't happen if cache is populated, but handle gracefully
          if (!controller.signal.aborted) setLoading(false);
        });
      return () => {
        controller.abort();
      };
    }
    getAssetsConfig({ signal: controller.signal })
      .then((cfg) => {
        cachedAt = Date.now();
        if (!controller.signal.aborted) setConfig(cfg);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setError(
          e instanceof Error ? e.message : 'Failed to load configuration',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [tick]);
  return { config, loading, error, refresh };
}