import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Invariant function that throws an error if the condition is falsy.
 * Use this instead of console.assert for invariant checks in production.
 */
export function invariant(
  condition: unknown,
  message?: string
): asserts condition {
  if (!condition) {
    throw new Error(message ?? "Invariant violation");
  }
}

type NumberLocale = string | string[];

let currentAppLocale: NumberLocale | undefined;

/**
 * Set the current application locale for formatting.
 */
export function setAppLocale(locale?: NumberLocale): void {
  currentAppLocale = locale;
}

/**
 * Get the currently configured application locale, if any.
 */
export function getAppLocale(): NumberLocale | undefined {
  return currentAppLocale;
}

function resolveNumberLocale(locale?: NumberLocale): NumberLocale | undefined {
  if (locale) return locale;
  if (currentAppLocale) return currentAppLocale;
  if (typeof document !== "undefined") {
    const htmlLang = document.documentElement?.lang?.trim();
    if (htmlLang) return htmlLang;
  }
  if (typeof navigator === "undefined") return undefined;

  return navigator.languages?.length
    ? Array.from(navigator.languages)
    : navigator.language;
}

function formatNumber(
  amount: string | number | null | undefined,
  {
    locale,
    minimumFractionDigits = 0,
    maximumFractionDigits,
  }: {
    locale?: NumberLocale;
    minimumFractionDigits?: number;
    maximumFractionDigits: number;
  },
): string {
  if (
    amount === null ||
    amount === undefined ||
    (typeof amount === "string" && amount.trim() === "")
  ) {
    return "—";
  }

  const num = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(num)) return "—";

  return new Intl.NumberFormat(resolveNumberLocale(locale), {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(num);
}

/**
 * Format a token amount with Stellar standards (7 decimals) and thousand-separators.
 * Falls back to "—" for null/undefined/invalid values.
 */
export function formatAmount(
  amount: string | number | null | undefined,
  decimals = 7,
  locale?: NumberLocale,
): string {
  return formatNumber(amount, {
    locale,
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format an ACBU amount with locale-aware grouping and up to 7 decimals.
 */
export function formatAcbu(
  amount: string | number | null | undefined,
  locale?: NumberLocale,
): string {
  return formatNumber(amount, {
    locale,
    minimumFractionDigits: 0,
    maximumFractionDigits: 7,
  });
}

export const normalizeUsername = (input: string) => {
  return input.toLowerCase().trim();
}

/**
 * Safe conversion of UTC timestamp strings from the API (which may lack a trailing Z or timezone indicator)
 * into a local Date object, ensuring the user's local timezone offset is applied.
 */
export function parseUtcDate(iso: string | null | undefined): Date {
  if (!iso) return new Date();
  const trimmed = String(iso).trim();
  const hasTimezone = /Z|[+-]\d{2}:?\d{2}$/.test(trimmed);
  const utcString = hasTimezone ? trimmed : (trimmed.includes(' ') ? trimmed.replace(' ', 'T') : trimmed) + 'Z';
  return new Date(utcString);
}

