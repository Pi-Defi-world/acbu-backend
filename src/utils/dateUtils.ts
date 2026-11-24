/**
 * Timezone-aware date helpers for business calendars (#408).
 * Uses IANA time zones via Intl instead of fixed UTC offsets or server-local dates.
 */
import { config } from "../config/env";

export interface CalendarParts {
  year: number;
  month: number;
  day: number;
}

export interface ZonedDateParts extends CalendarParts {
  hour: number;
  minute: number;
  second: number;
}

const IANA_TIMEZONE_PATTERN = /^[A-Za-z0-9_+/-]+$/;

export function getDefaultBusinessTimeZone(): string {
  return config.businessTimeZone;
}

/** Prefer caller/user timezone when valid; otherwise fall back to business default. */
export function resolveTimeZone(preferred?: string): string {
  if (preferred && isValidTimeZone(preferred)) {
    return preferred;
  }
  return getDefaultBusinessTimeZone();
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!IANA_TIMEZONE_PATTERN.test(timeZone)) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function assertSafeSqlTimeZone(timeZone: string): string {
  const resolved = resolveTimeZone(timeZone);
  if (!IANA_TIMEZONE_PATTERN.test(resolved)) {
    throw new Error(`Invalid timezone for SQL: ${resolved}`);
  }
  return resolved;
}

export function getZonedParts(date: Date, timeZone: string): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

export function getZonedDayOfMonth(date: Date, timeZone?: string): number {
  return getZonedParts(date, resolveTimeZone(timeZone)).day;
}

export function addCalendarDays(parts: CalendarParts, days: number): CalendarParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function addCalendarMonths(parts: CalendarParts, months: number): CalendarParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1 + months, parts.day));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Convert a wall-clock time in `timeZone` to the corresponding UTC instant. */
export function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  let guessMs = Date.UTC(year, month - 1, day, hour, minute, second);

  for (let attempt = 0; attempt < 3; attempt++) {
    const zoned = getZonedParts(new Date(guessMs), timeZone);
    const desiredMs = Date.UTC(year, month - 1, day, hour, minute, second);
    const actualMs = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second,
    );
    guessMs += desiredMs - actualMs;
  }

  return new Date(guessMs);
}

export function getStartOfZonedDay(date: Date, timeZone?: string): Date {
  const tz = resolveTimeZone(timeZone);
  const parts = getZonedParts(date, tz);
  return zonedDateTimeToUtc(parts.year, parts.month, parts.day, 0, 0, 0, tz);
}

export function getStartOfZonedMonth(date: Date, timeZone?: string): Date {
  const tz = resolveTimeZone(timeZone);
  const parts = getZonedParts(date, tz);
  return zonedDateTimeToUtc(parts.year, parts.month, 1, 0, 0, 0, tz);
}

export function formatIsoDateInTimeZone(date: Date, timeZone?: string): string {
  const parts = getZonedParts(date, resolveTimeZone(timeZone));
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** Next midnight strictly after `from` in the given timezone (for daily salary schedules). */
export function getNextDailyMidnight(from: Date, timeZone?: string): Date {
  const tz = resolveTimeZone(timeZone);
  const parts = getZonedParts(from, tz);
  const tomorrow = addCalendarDays({ year: parts.year, month: parts.month, day: parts.day }, 1);
  return zonedDateTimeToUtc(tomorrow.year, tomorrow.month, tomorrow.day, 0, 0, 0, tz);
}

/** Earliest upcoming midnight in timezone that is still in the future. */
export function getInitialDailyMidnight(from: Date, timeZone?: string): Date {
  const tz = resolveTimeZone(timeZone);
  const parts = getZonedParts(from, tz);
  const todayMidnight = zonedDateTimeToUtc(parts.year, parts.month, parts.day, 0, 0, 0, tz);

  if (todayMidnight > from) {
    return todayMidnight;
  }

  return getNextDailyMidnight(from, tz);
}
