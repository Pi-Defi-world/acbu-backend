/**
 * External exchange-rate fetcher with positive and negative response caching (#404).
 * Caches API failures (5xx, timeout, network) so degraded upstreams are not retried on every request.
 */
import axios from "axios";
import { config } from "../../config/env";
import { logger } from "../../config/logger";

/**
 * Cache TTL configuration (#1407, W11-AUD-004):
 * - The on-chain acbu_oracle contract rejects rate attestations older than 300 seconds (5 minutes).
 * - Align backend exchange rate cache TTL to 180 seconds (3 minutes) to guarantee rates submitted
 *   or verified on-chain never breach contract staleness bounds.
 * - MAX_EXCHANGE_RATE_CACHE_TTL_MS clamps any external environment override to 180s.
 */
export const MAX_EXCHANGE_RATE_CACHE_TTL_MS = 180_000; // 180 seconds (3 minutes)
export const DEFAULT_POSITIVE_TTL_MS = 180_000; // 180 seconds (3 minutes)
export const DEFAULT_NEGATIVE_TTL_MS = 30_000; // 30 seconds
const REQUEST_TIMEOUT_MS = 10_000;

interface ExchangeRateApiPairResponse {
  result?: string;
  conversion_rate?: number;
}

interface CacheEntry {
  rate: number | null;
  expiresAt: number;
}

const MIN_REASONABLE_EXCHANGE_RATE = 1e-8;
const MAX_REASONABLE_EXCHANGE_RATE = 1_000_000;

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<number | null>>();

export function isReasonableExchangeRate(rate: number): boolean {
  return (
    Number.isFinite(rate) &&
    rate > 0 &&
    rate >= MIN_REASONABLE_EXCHANGE_RATE &&
    rate <= MAX_REASONABLE_EXCHANGE_RATE
  );
}

export function resolveExchangeRateCacheTtlMs(success: boolean): number {
  if (!success) {
    const rawNeg = parseInt(
      process.env.EXCHANGE_RATE_NEGATIVE_CACHE_TTL_MS || String(DEFAULT_NEGATIVE_TTL_MS),
      10,
    );
    return Number.isFinite(rawNeg) && rawNeg > 0 ? rawNeg : DEFAULT_NEGATIVE_TTL_MS;
  }
  const rawPos = parseInt(
    process.env.EXCHANGE_RATE_CACHE_TTL_MS || String(DEFAULT_POSITIVE_TTL_MS),
    10,
  );
  const ttl = Number.isFinite(rawPos) && rawPos > 0 ? rawPos : DEFAULT_POSITIVE_TTL_MS;
  return Math.min(ttl, MAX_EXCHANGE_RATE_CACHE_TTL_MS);
}

/** True for upstream/transient failures that should be negative-cached. */
export function isRetryableRateApiError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return true;

  const status = error.response?.status;
  if (status !== undefined && status >= 500) return true;
  if (status === 408 || status === 429) return true;
  if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") return true;
  if (!error.response) return true;

  return false;
}

export function getCachedExchangeRate(currency: string): number | null | undefined {
  const key = currency.toUpperCase();
  const entry = cache.get(key);
  if (!entry) return undefined;

  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }

  return entry.rate;
}

export function setCachedExchangeRate(
  currency: string,
  rate: number | null,
  success: boolean,
): void {
  cache.set(currency.toUpperCase(), {
    rate,
    expiresAt: Date.now() + resolveExchangeRateCacheTtlMs(success),
  });
}

export function invalidateExchangeRateCache(currency?: string): void {
  if (currency) {
    cache.delete(currency.toUpperCase());
    return;
  }
  cache.clear();
}

async function fetchFromExternalApi(currency: string): Promise<number | null> {
  const apiKey = config.oracle.forex.apiKey;
  if (!apiKey) return null;

  const url = `${config.oracle.forex.baseUrl}/${apiKey}/pair/${currency}/USD`;
  const { data } = await axios.get<ExchangeRateApiPairResponse>(url, {
    timeout: REQUEST_TIMEOUT_MS,
  });

  if (data.result === "success" && typeof data.conversion_rate === "number") {
    if (!isReasonableExchangeRate(data.conversion_rate)) {
      logger.warn("Exchange rate API returned a value outside sane bounds", {
        currency,
        conversionRate: data.conversion_rate,
        min: MIN_REASONABLE_EXCHANGE_RATE,
        max: MAX_REASONABLE_EXCHANGE_RATE,
      });
      return null;
    }

    return data.conversion_rate;
  }

  return null;
}

export interface FetchExchangeRateOptions {
  forceRefresh?: boolean;
}

/**
 * Fetch USD rate for 1 unit of the given currency (e.g. 1 NGN = x USD).
 * Successful responses and retryable failures are cached independently.
 * Pass { forceRefresh: true } to bypass cache and trigger immediate refresh (#1407).
 */
export async function fetchExchangeRateUsd(
  currency: string,
  options?: FetchExchangeRateOptions,
): Promise<number | null> {
  const key = currency.toUpperCase();

  if (options?.forceRefresh) {
    invalidateExchangeRateCache(key);
  } else {
    const cached = getCachedExchangeRate(key);
    if (cached !== undefined) {
      return cached;
    }
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async (): Promise<number | null> => {
    try {
      const rate = await fetchFromExternalApi(key);
      const success = rate != null && rate > 0;
      setCachedExchangeRate(key, success ? rate : null, success);
      return success ? rate : null;
    } catch (error) {
      logger.warn("Exchange rate API request failed", { currency: key, error });

      if (isRetryableRateApiError(error)) {
        setCachedExchangeRate(key, null, false);
      }

      return null;
    }
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);
  return promise;
}

/**
 * Refresh exchange rate immediately and return the fresh rate.
 */
export async function refreshExchangeRate(currency: string): Promise<number | null> {
  return fetchExchangeRateUsd(currency, { forceRefresh: true });
}

/**
 * Trigger an immediate background refresh of the exchange rate without awaiting (#1407).
 */
export function triggerBackgroundExchangeRateRefresh(currency: string): void {
  invalidateExchangeRateCache(currency);
  fetchExchangeRateUsd(currency, { forceRefresh: true }).catch((error) => {
    logger.warn("Background exchange rate refresh failed", { currency, error });
  });
}
