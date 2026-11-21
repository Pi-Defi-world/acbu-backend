import { get } from './client';
import type { RequestOptions } from './client';
import type { RatesResponse, QuoteResponse } from '@/types/api';
import { useCallback, useEffect, useState } from 'react';

const RATES_TTL_MS = 60_000; // 1 minute

let cachedRates: RatesResponse | null = null;
let cacheExpiry = 0;

export async function getRates(opts?: RequestOptions): Promise<RatesResponse> {
  const now = Date.now();
  if (cachedRates && now < cacheExpiry) {
    return cachedRates;
  }
  const data = await get<RatesResponse>('/rates', opts);
  cachedRates = data;
  cacheExpiry = now + RATES_TTL_MS;
  return data;
}

export function clearRatesCache(): void {
  cachedRates = null;
  cacheExpiry = 0;
}


export interface UseRatesResult {
  data: RatesResponse | null;
  loading: boolean;
  error: string;
  refetch: () => void;
}

/**
 * Lightweight rates fetch hook (non-React-Query).
 * Provides an `{ error, refetch }` shape for UI retry.
 */
export function useRates(opts?: RequestOptions): UseRatesResult {
  const [data, setData] = useState<RatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    getRates({ ...opts, signal: controller.signal })
      .then((d) => {
        if (!controller.signal.aborted) setData(d);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(e instanceof Error ? e.message : 'Failed to load rates');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return { data, loading, error, refetch };
}

export async function getQuote(
  amount: number | string,
  currency?: string,
  opts?: RequestOptions
): Promise<QuoteResponse> {
  const params = new URLSearchParams({ amount: String(amount) });
  if (currency) params.set('currency', currency);
  return get<QuoteResponse>(`/rates/quote?${params.toString()}`, opts);
}
