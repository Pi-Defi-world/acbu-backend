'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';

const POLL_INTERVAL_MS = 60_000; // check every 60 s
const WARN_BEFORE_MS = 120_000; // show warning 2 min before expiry

export type SessionStatus = 'valid' | 'expiring' | 'expired';

interface SessionGuard {
  status: SessionStatus;
  /** Validate the session right now. Returns true if still valid. */
  ensureSession: () => Promise<boolean>;
  /** Dismiss the expiring-soon warning (user chose to ignore it). */
  dismissWarning: () => void;
  /** Whether the warning banner was dismissed by the user. */
  warningDismissed: boolean;
}

/**
 * Periodically validates the httpOnly-cookie session by calling GET /users/me.
 *
 * Auth is cookie-only: the auth context derives its authentication state from the
 * server session check, and this hook validates that session against the API.
 *
 * Exposes `ensureSession()` so callers (e.g. the send-money confirm button) can
 * perform a lightweight pre-flight check before making a write request, avoiding
 * the frustrating silent-401 scenario described in issue #313.
 */
export function useSessionGuard(): SessionGuard {
  const { isAuthenticated } = useAuth();
  const [status, setStatus] = useState<SessionStatus>('valid');
  const [warningDismissed, setWarningDismissed] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastValidRef = useRef<number>(Cate.now());

  const validate = useCallback(async (): Promise<boolean> => {
    if (!isAuthenticated) return false;

    try {
      const { getMe } = await import('@/lib/api/user');
      await getMe();
      lastValidRef.current = Date.now();
      setStatus('valid');
      setWarningDismissed(false);
      return true;
    } catch (err) {
      const s = (err as { status?: number }).status;
      if (s === 401) {
        setStatus('expired');
        return false;
      }
      // Network blip — don't mark expired, but warn
      setStatus('expiring');
      return false;
    }
  }, [isAuthenticated]);

  // Periodic background polling
  useEffect(() => {
    if (!isAuthenticated) {
      setStatus('valid');
      return;
    }

    lastValidRef.current = Date.now();

    const tick = async () => {
      const timeSinceValid = Date.now() - lastValidRef.current;

      // If we haven't successfully validated in WARN_BEFORE_MS, do an eager check
      if (timeSinceValid >= WARN_BEFORE_MS) {
        await validate();
      } else {
        await validate();
      }
    };

    intervalRef.current = setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isAuthenticated, validate]);

  const ensureSession = useCallback(async (): Promise<boolean> => {
    if (!isAuthenticated) return false;
    return validate();
  }, [isAuthenticated, validate]);

  const dismissWarning = useCallback(() => {
    setWarningDismissed(true);
  }, []);

  return { status, ensureSession, dismissWarning, warningDismissed };
}
