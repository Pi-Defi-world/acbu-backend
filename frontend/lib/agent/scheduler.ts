/**
 * Injectable-clock scheduler for the agent layer.
 *
 * Design goals
 * ────────────
 *  1. **Testability** – all time operations go through an injectable `Clock`
 *     interface so tests never sleep and never depend on wall-clock state.
 *  2. **Timezone awareness** – schedules are evaluated in a configured IANA
 *     timezone (defaults to UTC), so a "run at midnight" job fires at local
 *     midnight regardless of the server's TZ env var.
 *  3. **DST safety** – the scheduler computes the next wall-clock instant by
 *     working in local calendar time, then converts to UTC, so it handles both
 *     the spring-forward gap (job fires once, after the gap) and the fall-back
 *     overlap (job fires only once on the first occurrence).
 *  4. **Missed-run policy** – if the process was suspended/sleeping and a tick
 *     wakes up late, the scheduler applies one of two configurable policies:
 *       - `"skip"`  – silently drop every missed fire (default)
 *       - `"runAll"` – synchronously invoke the job for every missed interval
 *
 * Async note
 * ──────────
 * Rescheduling is **synchronous** — it happens before any async job work.
 * This keeps `nextFireAt` accurate immediately after the timeout fires,
 * which is essential for deterministic fake-clock testing.  The job itself
 * is invoked fire-and-forget; unhandled rejections are swallowed so one
 * bad job run cannot prevent future firings.
 */

// ─── Clock abstraction ────────────────────────────────────────────────────────

/** Minimal interface for time – swap out in tests. */
export interface Clock {
  /** Current epoch-milliseconds (like Date.now()). */
  now(): number;
  /**
   * Schedule a callback after `ms` milliseconds.
   * Returns an opaque handle that can be passed to `clearTimeout`.
   */
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  /** Cancel a previously scheduled callback. */
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

/** Production clock that delegates to the global timer APIs. */
export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h),
};

// ─── Public types ─────────────────────────────────────────────────────────────

export type MissedRunPolicy = 'skip' | 'runAll';

export interface SchedulerOptions {
  /**
   * IANA timezone string, e.g. `"America/New_York"`.
   * Defaults to `"UTC"`.
   */
  timezone?: string;

  /** How to handle missed firings.  Defaults to `"skip"`. */
  missedRunPolicy?: MissedRunPolicy;

  /** Clock implementation.  Defaults to `systemClock`. */
  clock?: Clock;
}

export interface ScheduledJob {
  /** Human-readable label for logging / debugging. */
  readonly name: string;
  /** Stop the job and release internal resources. */
  stop(): void;
  /**
   * Millisecond timestamp of the next scheduled fire (UTC epoch).
   * `null` when the job has been stopped or no future fire can be computed.
   */
  nextFireAt: number | null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Given a UTC epoch timestamp and an IANA timezone, returns a plain-object
 * representation of that moment in local calendar fields.
 */
function toLocalParts(
  epochMs: number,
  timezone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') {
      parts[part.type] = parseInt(part.value, 10);
    }
  }

  return {
    year: parts.year,
    month: parts.month, // 1-based
    day: parts.day,
    hour: parts.hour === 24 ? 0 : parts.hour, // Intl can return 24 for midnight
    minute: parts.minute,
    second: parts.second,
  };
}

/**
 * Convert local calendar fields back to UTC epoch milliseconds.
 *
 * Uses a two-pass offset estimation.  After converging, verifies the result
 * actually maps to the requested local time.  If the requested time falls
 * inside a DST spring-forward gap (the time literally doesn't exist), the
 * function advances by one DST-offset step to land on the first instant after
 * the gap.  This prevents a scheduler configured for a gap time from firing
 * one hour *earlier* than intended.
 */
function localPartsToUtc(
  year: number,
  month: number, // 1-based
  day: number,
  hour: number,
  minute: number,
  second: number,
  timezone: string,
): number {
  // First estimate: treat the local time as UTC
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);

  // Convert back to local to find the real offset
  const localAtNaive = toLocalParts(naiveUtcMs, timezone);
  const naiveLocal = Date.UTC(
    localAtNaive.year,
    localAtNaive.month - 1,
    localAtNaive.day,
    localAtNaive.hour,
    localAtNaive.minute,
    localAtNaive.second,
  );
  const offset1 = naiveUtcMs - naiveLocal;
  const estimate1 = naiveUtcMs + offset1;

  // Second pass to handle the edge where the offset changes right at the target
  const localAtEst1 = toLocalParts(estimate1, timezone);
  const est1Local = Date.UTC(
    localAtEst1.year,
    localAtEst1.month - 1,
    localAtEst1.day,
    localAtEst1.hour,
    localAtEst1.minute,
    localAtEst1.second,
  );
  const offset2 = estimate1 - est1Local;
  let result = naiveUtcMs + offset2;

  // DST gap detection: if the result maps back to a time strictly earlier than
  // requested, the target is inside a gap.  Advance by 1 h to land after the gap.
  const verify = toLocalParts(result, timezone);
  const verifyMs = Date.UTC(
    verify.year,
    verify.month - 1,
    verify.day,
    verify.hour,
    verify.minute,
    verify.second,
  );
  const requestedMs = Date.UTC(year, month - 1, day, hour, minute, second);
  if (verifyMs < requestedMs) {
    result += 60 * 60 * 1000; // advance past the gap
  }

  return result;
}

/**
 * Return the local parts for the calendar day *after* the given local date.
 * Works by finding noon of the current local day in UTC, adding 24 h (safe
 * across all DST transitions), then re-deriving local parts.
 */
function nextLocalDay(
  year: number,
  month: number,
  day: number,
  timezone: string,
): { year: number; month: number; day: number } {
  const noon = localPartsToUtc(year, month, day, 12, 0, 0, timezone);
  return toLocalParts(noon + 24 * 60 * 60 * 1000, timezone);
}

/**
 * Compute the next UTC epoch millisecond at which `targetHour:targetMinute:00`
 * occurs in `timezone`, strictly after `afterMs`.
 *
 * DST behaviour
 * ─────────────
 *  • Spring-forward gap: if the target local time falls inside the missing
 *    hour, `localPartsToUtc` advances past the gap, ensuring the job fires
 *    at the first valid instant on the far side.
 *  • Fall-back overlap: the function consistently picks the *first* occurrence
 *    (the pre-transition one), preventing double-firing.
 */
export function nextOccurrence(
  afterMs: number,
  targetHour: number,
  targetMinute: number,
  timezone: string,
): number {
  const local = toLocalParts(afterMs, timezone);

  // Try today's occurrence first
  let candidate = localPartsToUtc(
    local.year,
    local.month,
    local.day,
    targetHour,
    targetMinute,
    0,
    timezone,
  );

  // If the candidate is not strictly after `afterMs`, advance to the next
  // calendar day in the target timezone
  if (candidate <= afterMs) {
    const tomorrow = nextLocalDay(local.year, local.month, local.day, timezone);
    candidate = localPartsToUtc(
      tomorrow.year,
      tomorrow.month,
      tomorrow.day,
      targetHour,
      targetMinute,
      0,
      timezone,
    );
  }

  return candidate;
}

// ─── Safe fire helper ─────────────────────────────────────────────────────────

/** Invoke job synchronously, swallowing any throw or rejection. */
function safeInvoke(job: () => void | Promise<void>): void {
  try {
    const result = job();
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  } catch {
    // swallow synchronous errors
  }
}

// ─── Daily scheduler factory ──────────────────────────────────────────────────

/**
 * Create a daily scheduler that fires `job` once per day at `hour:minute`
 * in the configured timezone.
 *
 * @param name          - Label for logging.
 * @param hour          - 0-23 local hour.
 * @param minute        - 0-59 local minute.
 * @param job           - Async or sync callback to invoke on each fire.
 * @param options       - Timezone, missed-run policy, and clock overrides.
 *
 * @returns A `ScheduledJob` handle.  Call `.stop()` to cancel.
 *
 * @example
 * ```ts
 * const nightly = createDailyScheduler('nightly-report', 0, 0, async () => {
 *   await generateReport();
 * }, { timezone: 'Africa/Nairobi' });
 *
 * // Later…
 * nightly.stop();
 * ```
 */
export function createDailyScheduler(
  name: string,
  hour: number,
  minute: number,
  job: () => void | Promise<void>,
  options: SchedulerOptions = {},
): ScheduledJob {
  const timezone = options.timezone ?? 'UTC';
  const missedRunPolicy = options.missedRunPolicy ?? 'skip';
  const clock = options.clock ?? systemClock;

  let stopped = false;
  let handle: ReturnType<typeof setTimeout> | null = null;
  let lastFiredAt: number | null = null;

  const scheduled: ScheduledJob = {
    name,
    nextFireAt: null,
    stop() {
      stopped = true;
      if (handle !== null) {
        clock.clearTimeout(handle);
        handle = null;
      }
      scheduled.nextFireAt = null;
    },
  };

  function schedule() {
    if (stopped) return;

    const now = clock.now();
    const next = nextOccurrence(now, hour, minute, timezone);
    scheduled.nextFireAt = next;
    const delay = Math.max(0, next - now);

    handle = clock.setTimeout(onFire, delay);
  }

  function onFire() {
    if (stopped) return;
    handle = null;

    const fireTime = clock.now();

    // ── Missed-run detection ────────────────────────────────────────────────
    if (missedRunPolicy === 'runAll' && lastFiredAt !== null) {
      // Walk forward from the last fire, collecting any occurrence that was
      // strictly before the current fire time.
      let probe = lastFiredAt;
      while (!stopped) {
        const o = nextOccurrence(probe, hour, minute, timezone);
        if (o >= fireTime) break;
        safeInvoke(job);
        probe = o;
      }
    }

    // ── Current fire ──────────────────────────────────────────────────────
    lastFiredAt = fireTime;
    safeInvoke(job);

    // ── Reschedule (synchronous) ──────────────────────────────────────────
    schedule();
  }

  schedule();
  return scheduled;
}

// ─── Interval scheduler (sub-daily) ──────────────────────────────────────────

/**
 * Create a repeating scheduler that fires every `intervalMs` milliseconds.
 * Useful for sub-daily work (e.g. poll every 30 s).
 *
 * Missed-run policy
 * ─────────────────
 *  • `"skip"` (default) – each fire schedules the next timeout for
 *    `intervalMs` from the **current** `clock.now()`.  If the process was
 *    suspended, missed intervals are simply never triggered.
 *  • `"runAll"` – each fire first back-fills every missed interval (based on
 *    elapsed time since start), then reschedules from the current logical slot.
 */
export function createIntervalScheduler(
  name: string,
  intervalMs: number,
  job: () => void | Promise<void>,
  options: Omit<SchedulerOptions, 'timezone'> = {},
): ScheduledJob {
  const missedRunPolicy = options.missedRunPolicy ?? 'skip';
  const clock = options.clock ?? systemClock;

  let stopped = false;
  let handle: ReturnType<typeof setTimeout> | null = null;
  const startedAt = clock.now();

  // Logical tick count: how many interval-boundaries we have *logically* passed
  // (including catch-up runs for 'runAll').  Used for missed-run detection.
  let logicalTick = 0;

  const scheduled: ScheduledJob = {
    name,
    nextFireAt: startedAt + intervalMs,
    stop() {
      stopped = true;
      if (handle !== null) {
        clock.clearTimeout(handle);
        handle = null;
      }
      scheduled.nextFireAt = null;
    },
  };

  function scheduleFromNow() {
    if (stopped) return;
    const next = clock.now() + intervalMs;
    scheduled.nextFireAt = next;
    handle = clock.setTimeout(onFire, intervalMs);
  }

  function scheduleFromLogical() {
    if (stopped) return;
    // Next logical slot: logicalTick has already been incremented to account for
    // the current fire, so the *next* boundary is startedAt + logicalTick * intervalMs.
    const next = startedAt + logicalTick * intervalMs;
    scheduled.nextFireAt = next;
    const delay = Math.max(0, next - clock.now());
    // Always schedule at least 1 ms in the future to prevent cascading in
    // fake-clock tests where clock.now() === next (zero-delay loops).
    handle = clock.setTimeout(onFire, Math.max(1, delay));
  }

  function onFire() {
    if (stopped) return;
    handle = null;

    if (missedRunPolicy === 'runAll') {
      const fireTime = clock.now();
      // How many logical ticks should have elapsed by now?
      const expectedTicks = Math.floor((fireTime - startedAt) / intervalMs);
      // missedCount = intervals that elapsed but were never fired.
      // Subtract 1 to exclude the current tick we are about to fire.
      const missedCount = Math.max(0, expectedTicks - logicalTick - 1);

      // Fire for each missed tick first
      for (let i = 0; i < missedCount; i++) {
        if (stopped) return;
        logicalTick++;
        safeInvoke(job);
      }

      // Fire for the current tick
      logicalTick++;
      safeInvoke(job);

      // Reschedule from the next logical slot (strictly future)
      scheduleFromLogical();
    } else {
      // 'skip': just fire once and schedule relative to now
      safeInvoke(job);
      scheduleFromNow();
    }
  }

  // Initial schedule
  handle = clock.setTimeout(onFire, intervalMs);

  return scheduled;
}
