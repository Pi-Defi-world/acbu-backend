import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ratesApi from '@/lib/api/rates';
import { useRates, clearRatesCache } from '../use-rates';

vi.mock('@/lib/api/rates', () => ({
  getRates: vi.fn(),
  clearRatesCache: vi.fn(),
}));

vi.mock('@/hooks/use-api', () => ({
  useApiOpts: vi.fn(() => ({})),
}));

const mockRates = {
  base: 'USD',
  rates: { NGN: 1500, EUR: 0.92 },
  timestamp: Date.now(),
} as any;

describe('useRates and clearRatesCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRatesCache();
  });

  it('fetches rates on mount when cache is empty', async () => {
    vi.mocked(ratesApi.getRates).mockResolvedValue(mockRates);

    const { result } = renderHook(() => useRates());

    await act(async () => {});

    expect(ratesApi.getRates).toHaveBeenCalledTimes(1);
    expect(result.current.rates).toEqual(mockRates);
    expect(result.current.loading).toBe(false);
  });

  it('clearRatesCache invalidates cache and triggers underlying clearRatesCache', async () => {
    vi.mocked(ratesApi.getRates).mockResolvedValue(mockRates);

    const first = renderHook(() => useRates());
    await act(async () => {});
    expect(ratesApi.getRates).toHaveBeenCalledTimes(1);
    first.unmount();

    // Calling clearRatesCache should reset cache and call ratesApi.clearRatesCache
    clearRatesCache();
    expect(ratesApi.clearRatesCache).toHaveBeenCalled();

    // Next mount must fetch again because cache was cleared
    renderHook(() => useRates());
    await act(async () => {});
    expect(ratesApi.getRates).toHaveBeenCalledTimes(2);
  });
});
