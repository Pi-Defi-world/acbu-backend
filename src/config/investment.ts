/**
 * Investment withdrawal: business allowed dates and forced-removal fee.
 * Aligned with SAVINGS_AND_INVESTMENT_POLICY.MD.
 */
import { getZonedDayOfMonth } from "../utils/dateUtils";

/** Day-of-month (1–31) when business investment withdrawals are allowed without fee. Default: 1, 15. */
export const INVESTMENT_BUSINESS_ALLOWED_DAYS = (
  process.env.INVESTMENT_BUSINESS_ALLOWED_DAYS || "1,15"
)
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((d) => d >= 1 && d <= 31);

/** Fee (0–100) for forced/early business withdrawal. Default 1. */
export const INVESTMENT_FORCED_REMOVAL_FEE_PERCENT = Number(
  process.env.INVESTMENT_FORCED_REMOVAL_FEE_PERCENT || "1",
);

export function isBusinessWithdrawalAllowedDay(dayOfMonth: number): boolean {
  return INVESTMENT_BUSINESS_ALLOWED_DAYS.includes(dayOfMonth);
}

export function isBusinessWithdrawalAllowedDate(date: Date, timeZone?: string): boolean {
  return isBusinessWithdrawalAllowedDay(getZonedDayOfMonth(date, timeZone));
}
