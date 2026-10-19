import { prisma } from "../../config/database";

/**
 * What “1 ACBU” means in plain language
 * --------------------------------------
 * Think of 1 ACBU as a *basket* (a small portfolio), not a single currency:
 *
 *   1 ACBU  ≈  (q_NGN NGN)  +  (q_KES KES)  +  (q_ZAR ZAR)  + …
 *
 * You do **not** add “NGN + KES” as one number; each leg keeps its own units.
 * The **percent weights** only decide what *fraction of the basket’s total value*
 * each currency is responsible for.
 *
 * How the code picks each q_c
 * ---------------------------
 * 1. Fix a total basket size in a common measuring stick. We use **V = 1 USD**
 *    of *total basket value* (a numeraire so we can split one pie across many
 *    currencies). That is `usdNotionalPerAcbu` (default 1).
 *
 * 2. Basket config gives each currency a weight w_c (e.g. NGN 10%, KES 10%, …
 *    summing to 100% over the full basket). Only currencies with a fresh oracle
 *    rate r_c > 0 are used this tick; their weights are renormalized so the
 *    shares still sum to 100% of *priced* legs:
 *        W = Σ w_j   (over priced legs),   f_c = w_c / W.
 *    So f_c is “what share of the 1 ACBU *value* is in currency c”.
 *
 * 3. **USD value** assigned to leg c:  `V * f_c`  (e.g. if V=1 and f_NGN=0.1,
 *    the NGN slice is 0.10 USD of the basket).
 *
 * 4. Oracle says how expensive local money is in USD: `r_c` = USD per **1** unit
 *    of local (e.g. tiny number for NGN). **How many locals** for that slice?
 *        q_c = (V * f_c) / r_c
 *    Example: slice = 0.10 USD, r_NGN = 0.0007 USD per 1 NGN →
 *    q_NGN ≈ 0.10 / 0.0007 ≈ 143 NGN in that 1 ACBU.
 *
 * 5. Check: value of leg c in USD is q_c * r_c = V * f_c. Summed over all legs,
 *    total value = V. So “1 ACBU” is exactly **V USD worth** of that mix, and
 *    the **percents** shaped who got how much of that V; **FX** turned each slice
 *    into NGN, KES, etc.
 *
 * Your “1000 NGN + 100 KES + …” example is exactly the list of q_c values
 * (rounded for display); they change whenever oracle rates move, while the
 * *value shares* f_c follow the basket weights (after renormalization).
 */

export interface BasketLegInput {
  currency: string;
  weight: number;
}

export interface SyntheticBasketLeg {
  currency: string;
  /** Weight from BasketConfig (percent points toward 100 across full basket). */
  weightPercent: number;
  /** Share of the 1-ACBU notional allocated to this leg after renormalizing over priced currencies only. */
  effectiveValueFraction: number;
  /** Oracle: USD per one unit of local currency. */
  usdPerLocal: number;
  /** How many units of local currency c are in 1 ACBU at this consensus. */
  localPerOneAcbu: number;
  /** V × f_c — USD (numeraire) attributed to this leg; sums to `usdNotionalPerAcbu`. */
  usdValueInLeg: number;
}

export interface SyntheticBasketOneAcbu {
  /** Fixed notionally — defines “one” ACBU in USD for adding legs (typically 1). */
  usdNotionalPerAcbu: number;
  legs: SyntheticBasketLeg[];
}

/**
 * Build how much of each priced basket currency is needed for exactly `usdNotionalPerAcbu` USD
 * of synthetic basket (default: 1 ACBU = 1 USD notional split by weights).
 */
export function composeOneAcbuFromWeightsAndUsdRates(
  basket: BasketLegInput[],
  usdPerLocal: Record<string, number>,
  usdNotionalPerAcbu = 1,
): SyntheticBasketOneAcbu | null {
  const priced = basket.filter((b) => b.weight > 0 && (usdPerLocal[b.currency] ?? 0) > 0);
  if (priced.length === 0) {
    return null;
  }

  const W = priced.reduce((s, b) => s + b.weight, 0);
  if (W <= 0) {
    return null;
  }

  const legs: SyntheticBasketLeg[] = [];
  for (const { currency, weight } of priced) {
    const r = usdPerLocal[currency]!;
    const f = weight / W;
    const usdValueInLeg = usdNotionalPerAcbu * f;
    const localPerOneAcbu = usdValueInLeg / r;
    legs.push({
      currency,
      weightPercent: weight,
      effectiveValueFraction: f,
      usdPerLocal: r,
      localPerOneAcbu,
      usdValueInLeg,
    });
  }

  return { usdNotionalPerAcbu, legs };
}

/**
 * Latest oracle USD-per-local for each basket row, then {@link composeOneAcbuFromWeightsAndUsdRates}.
 */
export async function computeSyntheticBasketOneAcbuForBasket(
  basket: BasketLegInput[],
  usdNotionalPerAcbu = 1,
): Promise<SyntheticBasketOneAcbu | null> {
  const usdPerLocal: Record<string, number> = {};
  for (const { currency } of basket) {
    const latest = await prisma.oracleRate.findFirst({
      where: { currency },
      orderBy: { timestamp: "desc" },
    });
    const r = latest?.medianRate != null ? Number(latest.medianRate.toString()) : 0;
    if (r > 0) {
      usdPerLocal[currency] = r;
    }
  }
  return composeOneAcbuFromWeightsAndUsdRates(basket, usdPerLocal, usdNotionalPerAcbu);
}
