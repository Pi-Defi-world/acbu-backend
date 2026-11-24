import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockGetFiatAccounts = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/fiat', () => ({
  getFiatAccounts: mockGetFiatAccounts,
}));

vi.mock('@/hooks/use-api', () => ({
  useApiOpts: () => ({ token: 'test-token' }),
}));

import { useFiatAccounts } from '../use-fiat-accounts';

const sampleAccounts = [
  {
    id: 'acc1',
    currency: 'NGN',
    balance: '1000',
    bank_name: 'Test Bank',
    account_number: '0000000000',
    account_name: 'Test',
    ledger_entries: [],
  },
];

describe('useFiatAccounts', () => {
  beforeEach(() => {
    mockGetFiatAccounts.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads accounts on mount and passes an AbortSignal', async () => {
    mockGetFiatAccounts.mockResolvedValue({ accounts: sampleAccounts });

    const { result } = renderHook(() => useFiatAccounts());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.accounts).toEqual(sampleAccounts);
    expect(result.current.error).toBe('');
    expect(mockGetFiatAccounts).toHaveBeenCalledTimes(1);
    const callOpts = mockGetFiatAccounts.mock.calls[0][0];
    expect(callOpts.signal).toBeInstanceOf(AbortSignal);
    expect(callOpts.token).toBe('test-token');
  });

  it('aborts in-flight fetch on unmount so stale responses do not update state', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    mockGetFiatAccounts.mockReturnValue(fetchPromise);

    const { result, unmount } = renderHook(() => useFiatAccounts());

    await waitFor(() => {
      expect(mockGetFiatAccounts).toHaveBeenCalled();
    });

    expect(result.current.loading).toBe(true);

    const signal: AbortSignal = mockGetFiatAccounts.mock.calls[0][0].signal;
    expect(signal.aborted).toBe(false);

    unmount();
    expect(signal.aborted).toBe(true);

    // Resolving after unmount must not throw or leave hanging state updates.
    await act(async () => {
      resolveFetch({ accounts: sampleAccounts });
      await fetchPromise;
    });
  });

  it('aborts the previous request when refetch is triggered (rapid key change)', async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    mockGetFiatAccounts
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce({ accounts: sampleAccounts });

    const { result } = renderHook(() => useFiatAccounts());

    await waitFor(() => {
      expect(mockGetFiatAccounts).toHaveBeenCalledTimes(1);
    });

    const firstSignal: AbortSignal = mockGetFiatAccounts.mock.calls[0][0].signal;
    expect(firstSignal.aborted).toBe(false);

    await act(async () => {
      result.current.refetch();
    });

    // Previous in-flight request must be aborted when deps change.
    expect(firstSignal.aborted).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.accounts).toEqual(sampleAccounts);
    expect(mockGetFiatAccounts).toHaveBeenCalledTimes(2);

    // Resolving the aborted first request must not overwrite fresh data.
    await act(async () => {
      resolveFirst({
        accounts: [
          {
            id: 'stale',
            currency: 'KES',
            balance: '999',
            bank_name: 'Stale',
            account_number: '1',
            account_name: 'Stale',
            ledger_entries: [],
          },
        ],
      });
      await firstPromise;
    });

    expect(result.current.accounts).toEqual(sampleAccounts);
    expect(result.current.accounts[0].id).not.toBe('stale');
  });

  it('sets error on failure without treating AbortError as an error', async () => {
    mockGetFiatAccounts.mockRejectedValueOnce(new Error('Network down'));

    const { result } = renderHook(() => useFiatAccounts());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network down');
    expect(result.current.accounts).toEqual([]);
  });

  it('ignores AbortError from the API client', async () => {
    const abortErr = new Error('Aborted');
    abortErr.name = 'AbortError';
    mockGetFiatAccounts.mockRejectedValueOnce(abortErr);

    const { result } = renderHook(() => useFiatAccounts());

    // Give the promise microtask a chance to settle.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // AbortError should not surface as a user-facing error.
    expect(result.current.error).toBe('');
  });
});
