/**
 * lib/agent/scheduler.test.ts
 *
 * Deterministic, no-sleep tests for the injectable-clock scheduler.
 *
 * Test categories
 * ───────────────
 *  A. nextOccurrence – unit tests for the time-math helper
 *     A1. UTC midnight boundary
 *     A2. Configured-timezone midnight boundary (Africa/Nairobi UTC+3)
 *     A3. DST spring-forward gap (America/New_York, clocks jump 02:00→03:00)
 *     A4. DST fall-back overlap (America/New_York, clocks fall 02:00→01:00)
 *     A5. Negative: past time returns tomorrow's occurrence
 *
 *  B. createDailyScheduler – integration tests via fake clock
 *     B1. Fires at the correct UTC instant
 *     B2. Fires at the correct TZ-aware instant
 *     B3. Missed-run policy "skip" does NOT fire for missed intervals
 *     B4. Missed-run policy "runAll" fires for every missed interval
 *     B5. stop() prevents future fires
 *     B6. Job errors do not abort rescheduling
 *
 *  C. createIntervalScheduler – integration tests via fake clock
 *     C1. Fires once per interval
 *     C2. Missed-run policy "skip" does NOT fire for missed intervals
 *     C3. Missed-run policy "runAll" fires all missed intervals
 *     C4. stop() prevents future fires
 *     C5. Negative: delay of 0 ms fires immediately on next tick
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  nextOccurrence,
  createDailyScheduler,
  createIntervalScheduler,
  type Clock,
} from './scheduler';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Minimal manual fake-clock that records and drains pending timeouts.
 * Does NOT use vi.useFakeTimers so tests are self-contained.
 */
function createFakeClock(initialMs: number): Clock & {
  /** Advance clock by `ms` and run all callbacks whose deadline has passed. */
  tick(ms: number): void;
  /** Advance to an absolute epoch timestamp and drain all due callbacks. */
  advanceTo(epochMs: number): void;
  currentMs: number;
} {
  type Entry = { deadline: number; cb: () => void; id: number };
  let counter = 0;
  const queue: Map<number, Entry> = new Map();

  const clock = {
    currentMs: initialMs,

    now() {
      return clock.currentMs;
    },

    setTimeout(cb: () => void, ms: number): ReturnType<typeof setTimeout> {
      const id = ++counter;
      queue.set(id, { deadline: clock.currentMs + ms, cb, id });
      return id as unknown as ReturnType<typeof setTimeout>;
    },

    clearTimeout(handle: ReturnType<typeof setTimeout>) {
      queue.delete(handle as unknown as number);
    },

    tick(ms: number) {
      clock.advanceTo(clock.currentMs + ms);
    },

    advanceTo(epochMs: number) {
      clock.currentMs = epochMs;
      // Drain in deadline order; callbacks may schedule new timeouts
      let guard = 0;
      while (guard++ < 10_000) {
        const due: Entry[] = [...queue.values()].filter(
          (e) => e.deadline <= clock.currentMs,
        );
        if (due.length === 0) break;
        // Sort by deadline so callbacks fire in the intended order
        due.sort((a, b) => a.deadline - b.deadline);
        for (const entry of due) {
          queue.delete(entry.id);
          entry.cb();
        }
      }
    },
  };

  return clock;
}

// ─── A. nextOccurrence unit tests ─────────────────────────────────────────────

describe('nextOccurrence', () => {
  // ── A1 ────────────────────────────────────────────────────────────────────
  describe('A1: UTC midnight boundary', () => {
    it('returns midnight of the same UTC day when current time is before midnight', () => {
      // 2026-01-01 22:00:00 UTC
      const after = Date.UTC(2026, 0, 1, 22, 0, 0);
      const next = nextOccurrence(after, 0, 0, 'UTC');
      // Expect next to be 2026-01-02 00:00:00 UTC
      expect(next).toBe(Date.UTC(2026, 0, 2, 0, 0, 0));
    });

    it('returns the next day when current time is exactly at midnight', () => {
      const after = Date.UTC(2026, 0, 1, 0, 0, 0);
      const next = nextOccurrence(after, 0, 0, 'UTC');
      expect(next).toBe(Date.UTC(2026, 0, 2, 0, 0, 0));
    });

    it('returns same-day occurrence when current time is one second before target', () => {
      // 2026-06-15 23:59:59 UTC — target is 00:00 → rolls to next day
      const after = Date.UTC(2026, 5, 15, 23, 59, 59);
      const next = nextOccurrence(after, 0, 0, 'UTC');
      expect(next).toBe(Date.UTC(2026, 5, 16, 0, 0, 0));
    });

    it('targets a specific non-midnight UTC hour', () => {
      // Current: 2026-03-10 08:30:00 UTC — target: 14:00
      const after = Date.UTC(2026, 2, 10, 8, 30, 0);
      const next = nextOccurrence(after, 14, 0, 'UTC');
      expect(next).toBe(Date.UTC(2026, 2, 10, 14, 0, 0));
    });

    it('returns the next day when target hour has already passed today', () => {
      // Current: 2026-03-10 15:00:00 UTC — target: 14:00 → already passed
      const after = Date.UTC(2026, 2, 10, 15, 0, 0);
      const next = nextOccurrence(after, 14, 0, 'UTC');
      expect(next).toBe(Date.UTC(2026, 2, 11, 14, 0, 0));
    });
  });

  // ── A2 ────────────────────────────────────────────────────────────────────
  describe('A2: configured-timezone boundary (Africa/Nairobi UTC+3)', () => {
    const TZ = 'Africa/Nairobi';

    it('UTC 21:00 → local midnight is UTC 21:00 (00:00 EAT)', () => {
      // 2026-07-04 20:00:00 UTC  → local is 23:00 EAT, target 00:00 EAT
      const after = Date.UTC(2026, 6, 4, 20, 0, 0);
      const next = nextOccurrence(after, 0, 0, TZ);
      // 2026-07-04 21:00:00 UTC == 2026-07-05 00:00:00 EAT
      expect(next).toBe(Date.UTC(2026, 6, 4, 21, 0, 0));
    });

    it('rolls to next local day when past local midnight', () => {
      // 2026-07-04 22:00:00 UTC  → 2026-07-05 01:00 EAT — past local midnight
      const after = Date.UTC(2026, 6, 4, 22, 0, 0);
      const next = nextOccurrence(after, 0, 0, TZ);
      // Next 00:00 EAT == 2026-07-05 21:00 UTC
      expect(next).toBe(Date.UTC(2026, 6, 5, 21, 0, 0));
    });

    it('targets local 09:00 (06:00 UTC)', () => {
      const after = Date.UTC(2026, 6, 4, 4, 0, 0); // 07:00 EAT
      const next = nextOccurrence(after, 9, 0, TZ);
      expect(next).toBe(Date.UTC(2026, 6, 4, 6, 0, 0));
    });
  });

  // ── A3 ────────────────────────────────────────────────────────────────────
  describe('A3: DST spring-forward gap (America/New_York, 2026-03-08 02:00→03:00)', () => {
    const TZ = 'America/New_York';
    // In 2026, New York spring-forward: 2026-03-08 02:00 EST → 03:00 EDT
    // EST = UTC-5,  EDT = UTC-4

    it('a target inside the gap is pushed to just after the gap', () => {
      // 02:30 local doesn't exist — nextOccurrence should give the first valid
      // instant on the other side of the gap (03:00 EDT = 07:00 UTC)
      // "before the gap": 2026-03-08 01:00 EST = 06:00 UTC
      const beforeGap = Date.UTC(2026, 2, 8, 6, 0, 0); // 01:00 EST
      const next = nextOccurrence(beforeGap, 2, 30, TZ);
      // 02:30 local doesn't exist; the computed UTC should be at or after
      // 07:00 UTC (when clocks resume at 03:00 EDT)
      // The exact behavior: localPartsToUtc skips to the post-gap equivalent
      expect(next).toBeGreaterThanOrEqual(Date.UTC(2026, 2, 8, 7, 0, 0));
    });

    it('a target after the gap resolves correctly in EDT', () => {
      // Target 04:00 EDT (= 08:00 UTC on 2026-03-08)
      const before = Date.UTC(2026, 2, 8, 6, 0, 0); // 01:00 EST
      const next = nextOccurrence(before, 4, 0, TZ);
      expect(next).toBe(Date.UTC(2026, 2, 8, 8, 0, 0));
    });

    it('a target before the gap in EST resolves correctly', () => {
      // Target 01:00 EST (= 06:00 UTC on 2026-03-08) — still in standard time
      const midnight = Date.UTC(2026, 2, 8, 5, 0, 0); // 00:00 EST
      const next = nextOccurrence(midnight, 1, 0, TZ);
      expect(next).toBe(Date.UTC(2026, 2, 8, 6, 0, 0));
    });
  });

  // ── A4 ────────────────────────────────────────────────────────────────────
  describe('A4: DST fall-back overlap (America/New_York, 2026-11-01 02:00→01:00)', () => {
    const TZ = 'America/New_York';
    // 2026-11-01: clocks fall back at 02:00 EDT to 01:00 EST (UTC-5)
    // EDT = UTC-4

    it('target in the overlap fires only once (on the first occurrence)', () => {
      // 00:30 EDT = 04:30 UTC — before the overlap
      const beforeOverlap = Date.UTC(2026, 10, 1, 4, 30, 0);
      const next = nextOccurrence(beforeOverlap, 1, 30, TZ);
      // First 01:30 during EDT (UTC-4) = 05:30 UTC
      expect(next).toBe(Date.UTC(2026, 10, 1, 5, 30, 0));
      // Should NOT be the second occurrence at 06:30 UTC (EST, UTC-5)
      expect(next).not.toBe(Date.UTC(2026, 10, 1, 6, 30, 0));
    });

    it('a target after the transition resolves in EST', () => {
      // 03:00 EST (after clock-back) = 08:00 UTC
      const midOverlap = Date.UTC(2026, 10, 1, 6, 0, 0); // 01:00 EST (second time)
      const next = nextOccurrence(midOverlap, 3, 0, TZ);
      expect(next).toBe(Date.UTC(2026, 10, 1, 8, 0, 0));
    });
  });

  // ── A5 ────────────────────────────────────────────────────────────────────
  describe('A5: negative cases', () => {
    it('returns next-day occurrence when afterMs is already after the target today', () => {
      const after = Date.UTC(2026, 0, 5, 18, 0, 0); // 18:00 UTC
      const next = nextOccurrence(after, 6, 0, 'UTC'); // 06:00 already passed
      expect(next).toBe(Date.UTC(2026, 0, 6, 6, 0, 0));
    });

    it('rejects an invalid timezone gracefully (throws or falls back)', () => {
      // A bad TZ string causes Intl to throw — we test that the error propagates
      expect(() => nextOccurrence(Date.now(), 0, 0, 'Not/A/Zone')).toThrow();
    });
  });
});

// ─── B. createDailyScheduler integration tests ────────────────────────────────

describe('createDailyScheduler', () => {
  let clock: ReturnType<typeof createFakeClock>;

  beforeEach(() => {
    // Start at 2026-01-01 20:00:00 UTC
    clock = createFakeClock(Date.UTC(2026, 0, 1, 20, 0, 0));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── B1 ────────────────────────────────────────────────────────────────────
  describe('B1: fires at the correct UTC instant', () => {
    it('fires exactly once at 00:00 UTC the following day', () => {
      const calls: number[] = [];
      const job = createDailyScheduler('utc-midnight', 0, 0, () => calls.push(clock.now()), {
        timezone: 'UTC',
        clock,
      });

      // nextFireAt should be 2026-01-02 00:00:00 UTC
      expect(job.nextFireAt).toBe(Date.UTC(2026, 0, 2, 0, 0, 0));
      expect(calls).toHaveLength(0);

      // Advance to just before midnight — should not fire
      clock.advanceTo(Date.UTC(2026, 0, 1, 23, 59, 59));
      expect(calls).toHaveLength(0);

      // Advance to exactly midnight
      clock.advanceTo(Date.UTC(2026, 0, 2, 0, 0, 0));
      expect(calls).toHaveLength(1);
      expect(calls[0]).toBe(Date.UTC(2026, 0, 2, 0, 0, 0));

      job.stop();
    });

    it('fires at a specific UTC time (14:30)', () => {
      const calls: number[] = [];
      const job = createDailyScheduler('afternoon', 14, 30, () => calls.push(clock.now()), {
        timezone: 'UTC',
        clock,
      });

      clock.advanceTo(Date.UTC(2026, 0, 2, 14, 30, 0));
      expect(calls).toHaveLength(1);

      job.stop();
    });

    it('reschedules automatically after the first fire', () => {
      const calls: number[] = [];
      const job = createDailyScheduler('daily', 0, 0, () => calls.push(clock.now()), {
        timezone: 'UTC',
        clock,
      });

      // First fire
      clock.advanceTo(Date.UTC(2026, 0, 2, 0, 0, 0));
      expect(calls).toHaveLength(1);

      // Should have rescheduled to Jan 3
      expect(job.nextFireAt).toBe(Date.UTC(2026, 0, 3, 0, 0, 0));

      // Second fire
      clock.advanceTo(Date.UTC(2026, 0, 3, 0, 0, 0));
      expect(calls).toHaveLength(2);

      job.stop();
    });
  });

  // ── B2 ────────────────────────────────────────────────────────────────────
  describe('B2: fires at the correct TZ-aware instant', () => {
    it('fires at local midnight in Africa/Nairobi (UTC+3)', () => {
      // Local midnight = UTC 21:00 prev day
      const calls: number[] = [];
      // Clock starts at 2026-01-01 20:00 UTC (23:00 EAT — just before local midnight)
      const job = createDailyScheduler(
        'nairobi-midnight',
        0,
        0,
        () => calls.push(clock.now()),
        { timezone: 'Africa/Nairobi', clock },
      );

      // nextFireAt = 2026-01-01 21:00 UTC = 2026-01-02 00:00 EAT
      expect(job.nextFireAt).toBe(Date.UTC(2026, 0, 1, 21, 0, 0));

      clock.advanceTo(Date.UTC(2026, 0, 1, 20, 59, 59));
      expect(calls).toHaveLength(0);

      clock.advanceTo(Date.UTC(2026, 0, 1, 21, 0, 0));
      expect(calls).toHaveLength(1);

      job.stop();
    });

    it('fires at local 09:00 in America/New_York (standard time, UTC-5)', () => {
      // 09:00 EST = 14:00 UTC
      // Clock starts 2026-01-05 13:00 UTC (before 14:00)
      const testClock = createFakeClock(Date.UTC(2026, 0, 5, 13, 0, 0));
      const calls: number[] = [];

      const job = createDailyScheduler(
        'ny-morning',
        9,
        0,
        () => calls.push(testClock.now()),
        { timezone: 'America/New_York', clock: testClock },
      );

      expect(job.nextFireAt).toBe(Date.UTC(2026, 0, 5, 14, 0, 0));
      testClock.advanceTo(Date.UTC(2026, 0, 5, 14, 0, 0));
      expect(calls).toHaveLength(1);

      job.stop();
    });
  });

  // ── B3 ────────────────────────────────────────────────────────────────────
  describe('B3: missed-run policy "skip"', () => {
    it('does NOT fire for skipped intervals when the clock jumps ahead', async () => {
      const calls: number[] = [];
      const job = createDailyScheduler(
        'skip-policy',
        0,
        0,
        () => calls.push(clock.now()),
        { timezone: 'UTC', missedRunPolicy: 'skip', clock },
      );

      // Simulate a 3-day jump (skipping Jan 2 and Jan 3)
      clock.advanceTo(Date.UTC(2026, 0, 4, 0, 0, 0));

      // Should fire only once (for Jan 4) because "skip" discards missed ones
      expect(calls).toHaveLength(1);

      job.stop();
    });
  });

  // ── B4 ────────────────────────────────────────────────────────────────────
  describe('B4: missed-run policy "runAll"', () => {
    it('fires once per missed day when the clock jumps ahead', async () => {
      const calls: number[] = [];
      const job = createDailyScheduler(
        'runAll-policy',
        0,
        0,
        () => calls.push(clock.now()),
        { timezone: 'UTC', missedRunPolicy: 'runAll', clock },
      );

      // First fire at Jan 2 00:00 (normal)
      clock.advanceTo(Date.UTC(2026, 0, 2, 0, 0, 0));
      expect(calls).toHaveLength(1);

      // Simulate a 3-day jump while suspended — wakes up at Jan 5 00:00
      // Missed: Jan 3, Jan 4, Jan 5 (3 days)
      clock.advanceTo(Date.UTC(2026, 0, 5, 0, 0, 0));
      // Should fire 3 times: once for each of Jan 3, Jan 4, and Jan 5
      // (2 missed + 1 current = 3 total new fires)
      expect(calls).toHaveLength(4); // 1 original + 3 new

      job.stop();
    });
  });

  // ── B5 ────────────────────────────────────────────────────────────────────
  describe('B5: stop() prevents future fires', () => {
    it('does not fire after stop() is called', () => {
      const calls: number[] = [];
      const job = createDailyScheduler('stoppable', 0, 0, () => calls.push(clock.now()), {
        timezone: 'UTC',
        clock,
      });

      job.stop();
      expect(job.nextFireAt).toBeNull();

      clock.advanceTo(Date.UTC(2026, 0, 2, 0, 0, 0));
      expect(calls).toHaveLength(0);
    });

    it('sets nextFireAt to null on stop', () => {
      const job = createDailyScheduler('stoppable2', 0, 0, () => {}, {
        timezone: 'UTC',
        clock,
      });

      expect(job.nextFireAt).not.toBeNull();
      job.stop();
      expect(job.nextFireAt).toBeNull();
    });
  });

  // ── B6 ────────────────────────────────────────────────────────────────────
  describe('B6: job errors do not abort rescheduling', () => {
    it('reschedules even when the job throws', () => {
      let callCount = 0;
      const job = createDailyScheduler(
        'error-resilient',
        0,
        0,
        () => {
          callCount += 1;
          throw new Error('job failed');
        },
        { timezone: 'UTC', clock },
      );

      clock.advanceTo(Date.UTC(2026, 0, 2, 0, 0, 0));
      expect(callCount).toBe(1);

      // Should have rescheduled despite the error
      expect(job.nextFireAt).toBe(Date.UTC(2026, 0, 3, 0, 0, 0));

      clock.advanceTo(Date.UTC(2026, 0, 3, 0, 0, 0));
      expect(callCount).toBe(2);

      job.stop();
    });
  });
});

// ─── C. createIntervalScheduler integration tests ─────────────────────────────

describe('createIntervalScheduler', () => {
  let clock: ReturnType<typeof createFakeClock>;

  beforeEach(() => {
    // Start at 2026-01-01 12:00:00 UTC
    clock = createFakeClock(Date.UTC(2026, 0, 1, 12, 0, 0));
  });

  // ── C1 ────────────────────────────────────────────────────────────────────
  describe('C1: fires once per interval', () => {
    it('fires at each regular interval boundary', () => {
      const calls: number[] = [];
      const interval = 30_000; // 30 s
      const job = createIntervalScheduler('poller', interval, () => calls.push(clock.now()), {
        clock,
      });

      expect(calls).toHaveLength(0);

      clock.tick(interval);
      expect(calls).toHaveLength(1);

      clock.tick(interval);
      expect(calls).toHaveLength(2);

      clock.tick(interval);
      expect(calls).toHaveLength(3);

      job.stop();
    });

    it('exposes nextFireAt that advances with each tick', () => {
      const startMs = clock.now();
      const interval = 60_000;
      const job = createIntervalScheduler('watcher', interval, () => {}, { clock });

      expect(job.nextFireAt).toBe(startMs + interval);

      clock.tick(interval);
      expect(job.nextFireAt).toBe(startMs + 2 * interval);

      job.stop();
    });
  });

  // ── C2 ────────────────────────────────────────────────────────────────────
  describe('C2: missed-run policy "skip"', () => {
    it('fires only once when clock jumps multiple intervals', () => {
      const calls: number[] = [];
      const interval = 30_000;
      const job = createIntervalScheduler('skip-interval', interval, () => calls.push(clock.now()), {
        clock,
        missedRunPolicy: 'skip',
      });

      // Jump 5 intervals ahead — with "skip" we expect 1 fire
      clock.tick(5 * interval);
      expect(calls).toHaveLength(1);

      job.stop();
    });
  });

  // ── C3 ────────────────────────────────────────────────────────────────────
  describe('C3: missed-run policy "runAll"', () => {
    it('fires once per missed interval when clock jumps ahead', async () => {
      const calls: number[] = [];
      const interval = 30_000;
      const job = createIntervalScheduler(
        'runAll-interval',
        interval,
        () => calls.push(clock.now()),
        { clock, missedRunPolicy: 'runAll' },
      );

      // First normal tick
      clock.tick(interval);
      expect(calls).toHaveLength(1);

      // Jump 3 intervals ahead while "asleep"
      clock.tick(3 * interval);
      // Should fire 3 more times: 2 missed + 1 current
      expect(calls).toHaveLength(4);

      job.stop();
    });

    it('tolerates job errors in missed runs', () => {
      let count = 0;
      const job = createIntervalScheduler(
        'runAll-error',
        10_000,
        () => {
          count += 1;
          if (count % 2 === 0) throw new Error('oops');
        },
        { clock, missedRunPolicy: 'runAll' },
      );

      // Jump 3 intervals at once
      clock.tick(30_000);
      // 2 missed + 1 current = 3 calls (count=3)
      expect(count).toBe(3);

      job.stop();
    });
  });

  // ── C4 ────────────────────────────────────────────────────────────────────
  describe('C4: stop() prevents future fires', () => {
    it('does not fire after stop()', () => {
      const calls: number[] = [];
      const job = createIntervalScheduler('cancellable', 60_000, () => calls.push(clock.now()), {
        clock,
      });

      clock.tick(30_000);
      expect(calls).toHaveLength(0); // halfway there, not fired yet

      job.stop();

      clock.tick(30_000); // cross the original deadline
      expect(calls).toHaveLength(0); // still nothing
      expect(job.nextFireAt).toBeNull();
    });
  });

  // ── C5 ────────────────────────────────────────────────────────────────────
  describe('C5: negative cases', () => {
    it('does not fire before the first interval elapses', () => {
      const calls: number[] = [];
      const job = createIntervalScheduler('no-premature', 5_000, () => calls.push(clock.now()), {
        clock,
      });

      clock.tick(4_999);
      expect(calls).toHaveLength(0);

      clock.tick(1); // now exactly at 5000ms
      expect(calls).toHaveLength(1);

      job.stop();
    });

    it('nextFireAt is null after stop()', () => {
      const job = createIntervalScheduler('null-check', 1_000, () => {}, { clock });
      expect(job.nextFireAt).not.toBeNull();
      job.stop();
      expect(job.nextFireAt).toBeNull();
    });
  });
});
