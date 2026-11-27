"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useMemo,
} from "react";
import * as authApi from "@/lib/api/auth";
import { onAuthError } from "@/lib/api/client";
import { clearPasscode, clearTempPassphrase } from "@/lib/passcode-manager";
import { logger } from "@/lib/logger";
import { clearRatesCache } from "@/hooks/use-rates";
import { clearConfigCache } from "@/hooks/use-config";

/**
 * Auth is cookie-only: the backend issues an httpOnly session cookie and
 * all requests are made with `credentials: 'include'`. There is no client-side
 * token to set or send. `isAuthenticated` is derived from a server session check
 * (GET /users/me), not from a locally stored token.
 */

const USER_ID_KEY = "acbu_user_id";
const STELLAR_ADDRESS_KEY = "acbu_stellar_address";
const API_KEY_KEY = "acbu_api_key";

interface AuthState {
  userId: string | null;
  stellarAddress: string | null;
  isAuthenticated: boolean;
  isHydrated: boolean;
}

interface AuthContextValue extends AuthState {
  login: (
    userId: string,
    stellarAddress?: string | null,
    apiKey?: string | null,
  ) => void;
  logout: () => Promise<void>;
  setAuth: (
    userId: string | null,
    stellarAddress?: string | null,
    apiKey?: string | null,
  ) => void;
  refreshStellarAddress: () => Promise<void>;
  /**
   * Most recent session validation error (e.g. transient network failure).
   * 401 clears auth state and does not surface here.
   */
  sessionError: string;
  /** Re-run session validation. Useful for a Retry UI. */
  refetchSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function getStoredAuth(): AuthState {
  if (typeof window === "undefined") {
    return {
      userId: null,
      stellarAddress: null,
      isAuthenticated: false,
      isHydrated: false,
    };
  }
  const userId = sessionStorage.getItem(USER_ID_KEY);
  const stellarAddress = sessionStorage.getItem(STELLAR_ADDRESS_KEY);
  const apiKey = sessionStorage.getItem(API_KEY_KEY);

  return {
    userId,
    stellarAddress,
    // Note: this flag is only a hint for initial render; the authoritative
    // auth check is the server session validation in validateSession().
    isAuthenticated: !!userId,
    isHydrated: true,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    userId: null,
    stellarAddress: null,
    isAuthenticated: false,
    isHydrated: false,
  });
  const [sessionError, setSessionError] = useState("");

  // Validate session on mount by checking if the httpOnly cookie is still valid
  const validateSession = useCallback(async () => {
    const storedAuth = getStoredAuth();

    // If no userId in storage, definitely not authenticated
    if (!storedAuth.userId) {
      setSessionError("");
      setState({
        userId: null,
        stellarAddress: null,
        isAuthenticated: false,
        isHydrated: true,
      });
      return;
    }

    // Validate the httpOnly cookie by making an API call
    try {
      setSessionError("");
      const { getMe } = await import("@/lib/api/user");
      await getMe(); // If this succeeds, the cookie is valid

      // Cookie is valid, mark as authenticated
      setState({
        userId: storedAuth.userId,
        stellarAddress: storedAuth.stellarAddress,
        isAuthenticated: true,
        isHydrated: true,
      });
    } catch (error) {
      const status = (error as { status?: number })?.status;

      if (status === 401) {
        // Cookie is invalid or expired - clear stored auth
        // The onAuthError handler will also be triggered
        if (typeof window !== "undefined") {
          sessionStorage.removeItem(USER_ID_KEY);
          sessionStorage.removeItem(STELLAR_ADDRESS_KEY);
          sessionStorage.removeItem(API_KEY_KEY);
        }
        clearPasscode();
        setSessionError("");
        clearRatesCache();
        clearConfigCache();
        setState({
          userId: null,
          stellarAddress: null,
          isAuthenticated: false,
          isHydrated: true,
        });
      } else {
        // Network error or other transient failure
        // Keep stored data but mark as not authenticated until retry succeeds
        setSessionError(
          error instanceof Error ? error.message : "Failed to validate session",
        );
        setState({
          userId: storedAuth.userId,
          stellarAddress: storedAuth.stellarAddress,
          isAuthenticated: false,
          isHydrated: true,
        });
      }
    }
  }, []);

  useEffect(() => {
    void validateSession();
  }, [validateSession]);

  const setAuth = useCallback(
    (
      userId: string | null,
      stellarAddress: string | null = null,
      apiKey: string | null = null,
    ) => {
      if (typeof window !== "undefined") {
        if (userId) {
          sessionStorage.setItem(USER_ID_KEY, userId);
          if (stellarAddress) {
            sessionStorage.setItem(STELLAR_ADDRESS_KEY, stellarAddress);
          } else {
            sessionStorage.removeItem(STELLAR_ADDRESS_KEY);
          }
          if (apiKey) {
            sessionStorage.setItem(API_KEY_KEY, apiKey);
          }
        } else {
          sessionStorage.removeItem(USER_ID_KEY);
          sessionStorage.removeItem(STELLAR_ADDRESS_KEY);
          sessionStorage.removeItem(API_KEY_KEY);
        }
      }

      // Auth is cookie-only; the authoritative check is the server session
      // validation. When we just logged in, the cookie was set by the server,
      // so we can trust the new state immediately.
      setState({
        userId,
        stellarAddress,
        isAuthenticated: !!userId && !!apiKey,
        isHydrated: true,
      });

      // Invalidate shared caches on authentication / user identity change
      clearRatesCache();
      clearConfigCache();
    },
    [],
  );

  const refreshStellarAddress = useCallback(async () => {
    if (!state.isAuthenticated) return;
    try {
      const { getBalance } = await import("@/lib/api/user");
      const balance = await getBalance();

      if (balance.stellar_address) {
        setAuth(state.userId, balance.stellar_address);
      }
    } catch (e) {
      logger.error("Failed to refresh stellar address", e);
    }
  }, [state.isAuthenticated, state.userId, setAuth]);

  const login = useCallback(
    (
      userId: string,
      stellarAddress: string | null = null,
      apiKey: string | null = null,
    ) => {
      setAuth(userId, stellarAddress, apiKey);
    },
    [setAuth],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.signout();
    } catch {
      // ignore network errors; clear local state anyway
    }
    clearPasscode();
    clearTempPassphrase();
    setAuth(null, null);
  }, [setAuth]);

  // Register 401 error handler: when API returns 401, clear stale auth state
  useEffect(() => {
    onAuthError(() => {
      setAuth(null, null);
    });
  }, [setAuth]);

  const value = useMemo(
    () => ({
      ...state,
      login,
      logout,
      setAuth,
      refreshStellarAddress,
      sessionError,
      refetchSession: validateSession,
    }),
    [
      state,
      login,
      logout,
      setAuth,
      refreshStellarAddress,
      sessionError,
      validateSession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}