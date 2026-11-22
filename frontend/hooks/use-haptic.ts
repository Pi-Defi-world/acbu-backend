"use client";

import { useCallback, useMemo } from "react";

/**
 * Standardised vibration patterns (ms) for `navigator.vibrate()`.
 *
 * Each array alternates [vibrate, pause, vibrate, …].
 * Single-element arrays produce a single pulse.
 */
export const HapticPattern = {
  /** Subtle acknowledgement – e.g. toggling a switch, tab change */
  light: [10] as readonly number[],
  /** Standard confirmation – e.g. form submit, dialog open */
  medium: [25] as readonly number[],
  /** Critical action – e.g. Confirm Send, irreversible destructive action */
  heavy: [40, 30, 40] as readonly number[],
  /** Success – e.g. transaction completed */
  success: [15, 50, 30] as readonly number[],
  /** Error / warning – e.g. validation failure, insufficient balance */
  error: [50, 30, 50, 30, 50] as readonly number[],
} as const;

export type HapticIntensity = keyof typeof HapticPattern;

/**
 * Returns memoised haptic trigger functions that gracefully no-op when
 * `navigator.vibrate` is unavailable (desktop, restricted iframe, etc.)
 * or when the user prefers reduced motion.
 *
 * @example
 * ```tsx
 * const { triggerHaptic } = useHaptic();
 *
 * <Button onClick={() => { triggerHaptic('heavy'); handleConfirm(); }}>
 *   Confirm Send
 * </Button>
 * ```
 */
export function useHaptic() {
  const canVibrate = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function",
    [],
  );

  const prefersReducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  /**
   * Fire a single haptic pulse matching the given intensity.
   * Silently no-ops when the Vibration API is unavailable or the user
   * has enabled "prefers-reduced-motion".
   */
  const triggerHaptic = useCallback(
    (intensity: HapticIntensity = "medium") => {
      if (!canVibrate || prefersReducedMotion) return;
      try {
        navigator.vibrate([...HapticPattern[intensity]]);
      } catch {
        // Swallow – some browsers revoke vibrate in background tabs.
      }
    },
    [canVibrate, prefersReducedMotion],
  );

  /** Cancel any in-progress vibration. */
  const cancelHaptic = useCallback(() => {
    if (!canVibrate) return;
    try {
      navigator.vibrate(0);
    } catch {
      // no-op
    }
  }, [canVibrate]);

  return { triggerHaptic, cancelHaptic, canVibrate } as const;
}
