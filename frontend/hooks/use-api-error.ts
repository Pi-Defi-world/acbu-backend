import { useState, useCallback, useEffect, useRef } from "react";
import type { ApiError, ApiErrorResponse, UIError } from "@/types/api";

export type { UIError, UIErrorAction } from "@/types/api";

/**
 * Maps an API error status code to a user-friendly UIError.
 * Returns null for null/undefined input so callers can safely pass any caught value.
 */
export function mapApiError(err: unknown): UIError | null {
  if (err == null) return null;

  const status =
    (err as ApiError).status ?? (err as ApiErrorResponse).status ?? undefined;

  const rawMessage =
    err instanceof Error
      ? err.message
      : typeof (err as ApiErrorResponse).message === "string"
        ? (err as ApiErrorResponse).message
        : undefined;

  switch (status) {
    case 429:
      return {
        message: "Too many requests. Please wait a moment before trying again.",
        action: {
          label: "Wait and retry",
          disableSubmitFor: 30_000,
        },
      };
    case 503:
      return {
        message:
          "Our payment processor is temporarily down. Your funds are safe.",
        action: {
          label: "Check status page",
          href: "https://status.acbu.io",
        },
      };
    case 402:
      return {
        message: "Insufficient balance or payment required.",
        action: {
          label: "Deposit funds",
          href: "/savings/deposit",
        },
      };
    default:
      return {
        message: rawMessage ?? "Something went wrong. Please try again.",
      };
  }
}

/**
 * Hook that manages a UIError state derived from raw API errors.
 *
 * Usage:
 *   const { uiError, setApiError, clearError, isSubmitDisabled } = useApiError();
 *
 *   catch (e) { setApiError(e); }
 *
 *   {uiError && <ApiErrorDisplay error={uiError} onDismiss={clearError} />}
 */
export function useApiError() {
  const [uiError, setUiError] = useState<UIError | null>(null);
  const [submitDisabledUntil, setSubmitDisabledUntil] = useState<number>(0);
  const [isSubmitDisabled, setIsSubmitDisabled] = useState(false);

  // Tracks the currently-scheduled timeout so it can be explicitly cancelled
  // as defense-in-depth alongside the effect cleanup ordering.
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Always clear any timer left over from a previous run before doing
    // anything else — defensive, in addition to the cleanup fn below.
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (submitDisabledUntil <= 0) {
      setIsSubmitDisabled(false);
      return;
    }
    const now = Date.now();
    if (submitDisabledUntil <= now) {
      setIsSubmitDisabled(false);
      return;
    }
    setIsSubmitDisabled(true);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setIsSubmitDisabled(false);
    }, submitDisabledUntil - now);

    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [submitDisabledUntil]);

  const setApiError = useCallback((err: unknown) => {
    const mapped = mapApiError(err);
    setUiError(mapped);
    if (mapped?.action?.disableSubmitFor) {
      setSubmitDisabledUntil(Date.now() + mapped.action.disableSubmitFor);
    }
  }, []);

  const clearError = useCallback(() => {
    setUiError(null);
    setSubmitDisabledUntil(0);
  }, []);

  return { uiError, setApiError, clearError, isSubmitDisabled };
}
