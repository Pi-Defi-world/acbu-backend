/**
 * ACBU 10-currency basket definition (Stage 3B per MVP_PHASE.MD).
 * Used for: seed data (BasketConfig), fallback when DB has no active basket, and tests.
 * Runtime source of truth is BasketConfig in DB (stats + DAO); see BasketService.
 */

/** Currencies in weight-descending order: NGN, ZAR, KES, EGP, GHS, RWF, XOF, MAD, TZS, UGX */
export const BASKET_CURRENCIES: readonly string[] = [
  "NGN",
  "ZAR",
  "KES",
  "EGP",
  "GHS",
  "RWF",
  "XOF",
  "MAD",
  "TZS",
  "UGX",
] as const;

/** Target weights (percent) per currency; sum = 100 */
export const BASKET_WEIGHTS: Record<string, number> = {
  NGN: 18,
  ZAR: 15,
  KES: 12,
  EGP: 11,
  GHS: 9,
  RWF: 8,
  XOF: 8,
  MAD: 7,
  TZS: 6,
  UGX: 6,
};

/** Type for basket currency codes */
export type BasketCurrency = (typeof BASKET_CURRENCIES)[number];

/** Sum of weights; used for validation */
export const BASKET_WEIGHTS_SUM = Object.values(BASKET_WEIGHTS).reduce((a, b) => a + b, 0);

/** 100% expressed in basis points (100.00% = 10000 bps). */
export const BASKET_WEIGHT_BASIS_POINTS = 10000;

/**
 * Round normalized basket weights to exact 100.00% using basis-point allocation.
 * This protects against rounding drift when storing weights as Decimal(5,2).
 */
export function roundWeightsToExactBasisPoints(weights: Map<string, number>): Map<string, number> {
  const total = [...weights.values()].reduce((s, w) => s + w, 0);
  if (Math.abs(total - BASKET_WEIGHTS_SUM) > 1e-8) {
    throw new Error(
      `Basket weights must sum to ${BASKET_WEIGHTS_SUM.toFixed(2)}; got ${total.toFixed(8)}`,
    );
  }

  const entries = [...weights.entries()].map(([currency, weight]) => {
    if (weight < 0 || weight > 100) {
      throw new Error(`Invalid basket weight for ${currency}: ${weight}`);
    }

    const scaled = weight * 100;
    const floored = Math.floor(scaled);
    return {
      currency,
      scaled,
      floored,
      remainder: scaled - floored,
    };
  });

  const baseSum = entries.reduce((s, entry) => s + entry.floored, 0);
  const missing = BASKET_WEIGHT_BASIS_POINTS - baseSum;
  if (missing < 0 || missing > entries.length) {
    throw new Error(
      `Cannot allocate exact basis-point basket weights from provided values; got base sum ${baseSum}`,
    );
  }

  entries.sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < missing; i += 1) {
    entries[i].floored += 1;
  }

  return new Map(
    entries.map((entry) => [entry.currency, Number((entry.floored / 100).toFixed(2))]),
  );
}

/** Currencies that must NOT be deposited into the pool. Deposit API accepts only basket currencies. */
export const FORBIDDEN_DEPOSIT_CURRENCIES = ["USDC", "USDT"] as const;

/** Check if a currency code is allowed for pool deposit (must be in basket). */
export function isAllowedDepositCurrency(currency: string): boolean {
  return BASKET_CURRENCIES.includes(currency as BasketCurrency);
}

/** Check if a currency is forbidden (USDC/USDT). */
export function isForbiddenDepositCurrency(currency: string): boolean {
  return FORBIDDEN_DEPOSIT_CURRENCIES.includes(
    currency.toUpperCase() as (typeof FORBIDDEN_DEPOSIT_CURRENCIES)[number],
  );
}
