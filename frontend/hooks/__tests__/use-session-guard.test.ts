import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock getMe before importing the hook
const mockGetMe = vi.fn();
vi.mock('@/lib/api/user', () => ({
  getMe: (...args: unknown[]) => mockGetMe(...args),
}));

// Mock auth context
const mockAuth = { isAuthenticated: true };
vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => mockAuth,
}));

import { useSessionGuard } from '../use-session-guard';

describe('useSessionGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetMe.mockReset();
    mockAuth.isAuthenticated = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with status "valid"', () => {
    mockGetMe.mockResolvedValue({});
    const { result } = renderHook(() => useSessionGuard());
    expect(result.current.status).toBe('valid');
  });

  it('ensureSession returns true when getMe succeeds', async () => {
    mockGetMe.mockResolvedValue({ id: '1' });
    const { result } = renderHook(() => useSessionGuard());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.ensureSession();
    });
    expect(ok).toBe(true);
    expect(result.current.status).toBe('valid');
  });

  it('ensureSession returns false and sets status "expired" on 401', async () => {
    const err = new Error('Unauthorized') as Error & { status?: number };
    err.status = 401;
    mockGetMe.mockRejectedValue(err);

    const { result } = renderHook(() => useSessionGuard());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.ensureSession();
    });
    expect(ok).toBe(false);
    expect(result.current.status).toBe('expired');
  });

  it('ensureSession returns false and sets status "expiring" on network error', async () => {
    mockGetMe.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useSessionGuard());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.ensureSession();
    });
    expect(ok).toBe(false);
    expect(result.current.status).toBe('expiring');
  });

  it('ensureSession returns false when not authenticated', async () => {
    mockAuth.isAuthenticated = false;
    const { result } = renderHook(() => useSessionGuard());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.ensureSession();
    });
    expect(ok).toBe(false);
  });

  it('dismissWarning sets warningDismissed to true', () => {
    mockGetMe.mockResolvedValue({});
    const { result } = renderHook(() => useSessionGuard());

    expect(result.current.warningDismissed).toBe(false);
    act(() => result.current.dismissWarning());
    expect(result.current.warningDismissed).toBe(true);
  });

  it('successful validation resets warningDismissed', async () => {
    mockGetMe.mockResolvedValue({ id: '1' });
    const { result } = renderHook(() => useSessionGuard());

    act(() => result.current.dismissWarning());
    expect(result.current.warningDismissed).toBe(true);

    await act(async () => {
      await result.current.ensureSession();
    });
    expect(result.current.warningDismissed).toBe(false);
  });
});
