"use client";

import { useState, useEffect, useCallback } from "react";
import { useApiOpts } from "@/hooks/use-api";
import * as ratesApi from "@/lib/api/rates";
import type { RatesResponse } from "@/types/api";

/**
 * Stale-while-revalidate cache for exchange rates.
 *
 * Rates change infrequently (hourly at most), so a 5-minute staleTime
 * eliminates redundant network requests when components remount.
 * The cache is shared across all component instances via module scope.
 *
 * Error TTL: after a fetch failure the stale cache is considered expired
 * after ERROR_TTL (30 s) so users are not served indefinitely stale rates
 * during a prolonged rate-source outage (#789).
 */
const STALE_TIME = 5 * 60 * 1000; // 5 minutes
const ERROR_TTL = 30 * 1000; // 30 seconds – force expiry after repeated errors

let cachedRates: RatesResponse | null = null;
let cachedAt = 0;
let lastErrorAt = 0;
let inFlightPromise: Promise<RatesResponse> | null = null;

export function clearRatesCache(): void {
  cachedRates = null;
  cachedAt = 0;
  lastErrorAt = 0;
  inFlightPromise = null;
  ratesApi.clearRatesCache();
}

function isFresh(): boolean {
  if (cachedRates === null) return false;
  // If an error occurred after the last successful fetch and the error TTL
  // has elapsed, treat the cache as stale so callers retry promptly.
  if (lastErrorAt > cachedAt && Date.now() - lastErrorAt >= ERROR_TTL)
    return false;
  return Date.now() - cachedAt < STALE_TIME;
}

interface UseRatesReturn {
  rates: RatesResponse | null;
  loading: boolean;
  error: string;
  /** True when cached rates exist but the last fetch failed and ERROR_TTL has elapsed. */
  isStale: boolean;
  refresh: () => void;
}

/**
 * Fetches exchange rates with a 5-minute stale-while-revalidate cache.
 *
 * - On mount: returns cached data instantly if fresh, otherwise fetches.
 * - `refresh()`: forces a network fetch regardless of cache freshness.
 * - Cache is module-scoped and shared across all consumers.
 */
export function useRates(): UseRatesReturn {
  const opts = useApiOpts();
  const [rates, setRates] = useState<RatesResponse | null>(cachedRates);
  const [loading, setLoading] = useState(!isFresh());
  const [error, setError] = useState("");
  const [isStale, setIsStale] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    // If cache is fresh and this isn't a forced refresh, skip the fetch
    if (isFresh() && tick === 0) {
      setRates(cachedRates);
      setLoading(false);
      setIsStale(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError("");

    // Deduplicate concurrent requests; pass the abort signal so the
    // underlying fetch is cancelled when the component unmounts.
    const promise =
      inFlightPromise ??
      (inFlightPromise = ratesApi.getRates({ ...opts, signal: controller.signal }).finally(() => {
        inFlightPromise = null;
      }));

    promise
      .then((data) => {
        cachedRates = data;
        cachedAt = Date.now();
        if (!controller.signal.aborted) setRates(data);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : 'Failed to load rates');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [opts.token, tick]);

  return { rates, loading, error, isStale, refresh };
}
