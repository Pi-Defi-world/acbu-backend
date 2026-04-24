/**
 * Currency conversion utilities.
 * Converts local currency amounts to USD using stored exchange rates.
 * Uses high-precision Decimal math to avoid floating-point rounding errors.
 */

import { prisma } from "../../config/database";
import { Decimal } from "@prisma/client/runtime/library";
import { AppError } from "../../middleware/errorHandler";

/**
 * Mapping of currency codes to AcbuRate Decimal fields.
 * E.g., NGN maps to the acbuNgn field (how many NGN per 1 ACBU).
 * Updated to include all supported currencies.
 */
const CURRENCY_TO_RATE_FIELD: Record<string, keyof typeof rateField> = {
  NGN: "acbuNgn",
  ZAR: "acbuZar",
  KES: "acbuKes",
  EGP: "acbuEgp",
  GHS: "acbuGhs",
  RWF: "acbuRwf",
  XOF: "acbuXof",
  MAD: "acbuMad",
  TZS: "acbuTzs",
  UGX: "acbuUgx",
  EUR: "acbuEur",
  GBP: "acbuGbp",
  USD: "acbuUsd",
};

// Helper object to ensure type safety
const rateField = {
  acbuNgn: "acbuNgn",
  acbuZar: "acbuZar",
  acbuKes: "acbuKes",
  acbuEgp: "acbuEgp",
  acbuGhs: "acbuGhs",
  acbuRwf: "acbuRwf",
  acbuXof: "acbuXof",
  acbuMad: "acbuMad",
  acbuTzs: "acbuTzs",
  acbuUgx: "acbuUgx",
  acbuEur: "acbuEur",
  acbuGbp: "acbuGbp",
  acbuUsd: "acbuUsd",
};

/**
 * Convert a local currency amount to its USD equivalent using current exchange rates.
 *
 * Conversion Flow:
 * 1. Fetch the latest AcbuRate record
 * 2. Get the rate for the local currency (e.g., 1 ACBU = 1000 NGN)
 * 3. Calculate amount in ACBU: localAmount / localRate
 * 4. Convert ACBU to USD: acbuAmount * acbuUsdRate
 *
 * Example: Convert 100,000 NGN to USD
 * - Rates: 1 ACBU = 1000 NGN, 1 ACBU = $0.50 USD
 * - ACBU equivalent: 100,000 / 1000 = 100 ACBU
 * - USD equivalent: 100 * 0.50 = $50 USD
 *
 * @param localAmount - The amount in local currency (as number)
 * @param currency - The currency code (e.g., "NGN", "KES")
 * @returns The equivalent USD amount as a number with proper decimal precision
 * @throws AppError if currency not supported, rates not available, or conversion fails
 */
export async function convertLocalToUsd(
  localAmount: number,
  currency: string,
): Promise<number> {
  // Validate currency is supported
  if (!CURRENCY_TO_RATE_FIELD[currency]) {
    throw new AppError(
      `Currency ${currency} not supported for conversion. Please check the supported currency list.`,
      400,
    );
  }

  // Fetch the latest exchange rates
  const latestRate = await prisma.acbuRate.findFirst({
    orderBy: { timestamp: "desc" },
  });

  if (!latestRate) {
    throw new AppError(
      "Exchange rates not yet available. Please try again in a moment.",
      503,
    );
  }

  // Get the rate field name for this currency
  const rateFieldName = CURRENCY_TO_RATE_FIELD[currency];

  // Retrieve the local-to-ACBU rate (how many units of local currency per 1 ACBU)
  const localToAcbuRate = latestRate[rateFieldName as keyof typeof latestRate];

  if (!localToAcbuRate || localToAcbuRate.toNumber() <= 0) {
    throw new AppError(
      `Exchange rate for ${currency} is not available or invalid. Cannot process deposit at this time.`,
      503,
    );
  }

  // Convert using high-precision Decimal arithmetic
  const localAmountDecimal = new Decimal(localAmount);
  const rateDecimal = new Decimal(localToAcbuRate);

  // Calculate ACBU equivalent
  const acbuAmount = localAmountDecimal.dividedBy(rateDecimal);

  // Get USD rate per ACBU
  const acbuUsdRate = new Decimal(latestRate.acbuUsd);

  if (acbuUsdRate.toNumber() <= 0) {
    throw new AppError(
      "USD conversion rate is invalid. Cannot process deposit at this time.",
      503,
    );
  }

  // Convert ACBU to USD
  const usdAmount = acbuAmount.multipliedBy(acbuUsdRate);

  // Return as number with precision
  return usdAmount.toNumber();
}

/**
 * Convert a local currency amount to its USD equivalent using current exchange rates.
 * This version preserves the original amount as a string (Decimal) for audit logging.
 *
 * @param localAmount - The amount in local currency (as Decimal string or number)
 * @param currency - The currency code (e.g., "NGN", "KES")
 * @returns Object with both number and Decimal representations
 */
export async function convertLocalToUsdWithPrecision(
  localAmount: string | number,
  currency: string,
): Promise<{ usdAmount: number; originalAmount: Decimal; acbuEquivalent: Decimal }> {
  // Validate currency is supported
  if (!CURRENCY_TO_RATE_FIELD[currency]) {
    throw new AppError(
      `Currency ${currency} not supported for conversion. Please check the supported currency list.`,
      400,
    );
  }

  // Fetch the latest exchange rates
  const latestRate = await prisma.acbuRate.findFirst({
    orderBy: { timestamp: "desc" },
  });

  if (!latestRate) {
    throw new AppError(
      "Exchange rates not yet available. Please try again in a moment.",
      503,
    );
  }

  // Get the rate field name for this currency
  const rateFieldName = CURRENCY_TO_RATE_FIELD[currency];

  // Retrieve the local-to-ACBU rate
  const localToAcbuRate = latestRate[rateFieldName as keyof typeof latestRate];

  if (!localToAcbuRate || localToAcbuRate.toNumber() <= 0) {
    throw new AppError(
      `Exchange rate for ${currency} is not available or invalid. Cannot process deposit at this time.`,
      503,
    );
  }

  // Convert using high-precision Decimal arithmetic
  const localAmountDecimal = new Decimal(localAmount);
  const rateDecimal = new Decimal(localToAcbuRate);

  // Calculate ACBU equivalent
  const acbuAmount = localAmountDecimal.dividedBy(rateDecimal);

  // Get USD rate per ACBU
  const acbuUsdRate = new Decimal(latestRate.acbuUsd);

  if (acbuUsdRate.toNumber() <= 0) {
    throw new AppError(
      "USD conversion rate is invalid. Cannot process deposit at this time.",
      503,
    );
  }

  // Convert ACBU to USD
  const usdAmount = acbuAmount.multipliedBy(acbuUsdRate);

  return {
    usdAmount: usdAmount.toNumber(),
    originalAmount: localAmountDecimal,
    acbuEquivalent: acbuAmount,
  };
}
