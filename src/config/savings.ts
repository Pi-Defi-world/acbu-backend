/**
 * Savings: lock calendar (monthly dates when withdrawals are not allowed) and returns parameters.
 * Aligned with SAVINGS_AND_INVESTMENT_POLICY.MD.
 */
import {
  addCalendarMonths,
  getZonedDayOfMonth,
  getZonedParts,
  resolveTimeZone,
  zonedDateTimeToUtc,
} from "../utils/dateUtils";

/** Day-of-month (1–31) when savings withdrawals are locked. Default: 1 and 15. */
export const SAVINGS_LOCK_DAYS = (process.env.SAVINGS_LOCK_DAYS || "1,15")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((d) => d >= 1 && d <= 31);

/** APY (e.g. 3 for 3%) by term seconds. Default: 3/6/12 months. */
export const SAVINGS_APY_BY_TERM: Record<number, number> = (() => {
  const raw = process.env.SAVINGS_APY_BY_TERM;
  if (raw) {
    try {
      return JSON.parse(raw) as Record<number, number>;
    } catch {
      /* ignore */
    }
  }
  const threeMonths = 3 * 30 * 24 * 60 * 60;
  const sixMonths = 6 * 30 * 24 * 60 * 60;
  const twelveMonths = 12 * 30 * 24 * 60 * 60;
  return {
    [threeMonths]: 2,
    [sixMonths]: 2.5,
    [twelveMonths]: 3,
  };
})();

export function isSavingsLockDate(date: Date = new Date(), timeZone?: string): boolean {
  const day = getZonedDayOfMonth(date, timeZone);
  return SAVINGS_LOCK_DAYS.includes(day);
}

/** Next calendar date when withdrawal is allowed (after today). */
export function getNextSavingsWithdrawalDate(date: Date = new Date(), timeZone?: string): Date {
  const tz = resolveTimeZone(timeZone);
  const parts = getZonedParts(date, tz);
  const sorted = [...SAVINGS_LOCK_DAYS].sort((a, b) => a - b);

  for (const d of sorted) {
    if (d > parts.day) {
      return zonedDateTimeToUtc(parts.year, parts.month, d, 0, 0, 0, tz);
    }
  }

  const nextMonth = addCalendarMonths({ year: parts.year, month: parts.month, day: parts.day }, 1);
  return zonedDateTimeToUtc(nextMonth.year, nextMonth.month, sorted[0] ?? 1, 0, 0, 0, tz);
}

export function getApyForTerm(termSeconds: number): number {
  return SAVINGS_APY_BY_TERM[termSeconds] ?? 2;
}

/** Accrued yield = principal * (apy/100) * (daysLocked/365). */
export function computeAccruedYield(principal: number, apy: number, daysLocked: number): number {
  return (principal * (apy / 100) * daysLocked) / 365;
}
