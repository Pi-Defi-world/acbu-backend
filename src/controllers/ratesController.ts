/**
 * GET /v1/rates - Return current ACBU rates (from AcbuRate and OracleRate).
 * GET /v1/rates/quote - Return equivalent value for a given ACBU amount and optional target currency.
 * GET /v1/rates/basket - Local amounts per 1 ACBU from basket weights + oracle consensus.
 */
import { Request, Response, NextFunction } from "express";
import { AcbuRate } from "@prisma/client";
import { basketService } from "../services/basket";
import { getLatestAcbuRate } from "../services/rates/acbuRateCache";
import { computeSyntheticBasketOneAcbuForBasket } from "../services/oracle/syntheticBasket";

export async function getRates(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    let latest: AcbuRate | null = null;
    try {
      latest = await getLatestAcbuRate();
    } catch {
      // No rates yet
    }
    if (!latest) {
      res.status(200).json({
        acbu_usd: null,
        acbu_eur: null,
        acbu_ngn: null,
        acbu_kes: null,
        acbu_rwf: null,
        change_24h_usd: null,
        timestamp: new Date().toISOString(),
        message: "No rate data yet; oracle integration will populate.",
      });
      return;
    }
    res.status(200).json({
      acbu_usd: latest.acbuUsd.toString(),
      acbu_eur: latest.acbuEur?.toString() ?? null,
      acbu_gbp: latest.acbuGbp?.toString() ?? null,
      acbu_ngn: latest.acbuNgn?.toString() ?? null,
      acbu_kes: latest.acbuKes?.toString() ?? null,
      acbu_zar: latest.acbuZar?.toString() ?? null,
      acbu_rwf: latest.acbuRwf?.toString() ?? null,
      acbu_ghs: latest.acbuGhs?.toString() ?? null,
      acbu_egp: latest.acbuEgp?.toString() ?? null,
      acbu_mad: latest.acbuMad?.toString() ?? null,
      acbu_tzs: latest.acbuTzs?.toString() ?? null,
      acbu_ugx: latest.acbuUgx?.toString() ?? null,
      acbu_xof: latest.acbuXof?.toString() ?? null,
      change_24h_usd: latest.change24hUsd?.toString() ?? null,
      timestamp: latest.timestamp.toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /v1/rates/quote?amount=500&target=NGN
 * Returns equivalent value for amount ACBU in target currency (and USD).
 */
export async function getRatesQuote(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const amount = Math.max(0, Number(req.query.amount) || 0);

    let latest: AcbuRate | null = null;
    try {
      latest = await getLatestAcbuRate();
    } catch {
      // No rates yet
    }
    if (!latest) {
      res.status(200).json({
        amount_acbu: amount,
        equivalent: {},
        timestamp: new Date().toISOString(),
        message: "No rate data yet.",
      });
      return;
    }

    const equivalent: Record<string, string> = {};
    const acbuUsd = Number(latest.acbuUsd.toString());
    equivalent.USD = (amount * acbuUsd).toFixed(2);

    const rates: { code: string; val: number | null }[] = [
      { code: "EUR", val: latest.acbuEur != null ? Number(latest.acbuEur.toString()) : null },
      { code: "GBP", val: latest.acbuGbp != null ? Number(latest.acbuGbp.toString()) : null },
      { code: "NGN", val: latest.acbuNgn != null ? Number(latest.acbuNgn.toString()) : null },
      { code: "KES", val: latest.acbuKes != null ? Number(latest.acbuKes.toString()) : null },
      { code: "ZAR", val: latest.acbuZar != null ? Number(latest.acbuZar.toString()) : null },
      { code: "RWF", val: latest.acbuRwf != null ? Number(latest.acbuRwf.toString()) : null },
      { code: "GHS", val: latest.acbuGhs != null ? Number(latest.acbuGhs.toString()) : null },
      { code: "EGP", val: latest.acbuEgp != null ? Number(latest.acbuEgp.toString()) : null },
      { code: "MAD", val: latest.acbuMad != null ? Number(latest.acbuMad.toString()) : null },
      { code: "TZS", val: latest.acbuTzs != null ? Number(latest.acbuTzs.toString()) : null },
      { code: "UGX", val: latest.acbuUgx != null ? Number(latest.acbuUgx.toString()) : null },
      { code: "XOF", val: latest.acbuXof != null ? Number(latest.acbuXof.toString()) : null },
    ];
    for (const { code, val } of rates) {
      if (val != null && val > 0) {
        equivalent[code] = (amount * val).toFixed(2);
      }
    }

    res.status(200).json({
      amount_acbu: amount,
      equivalent,
      timestamp: latest.timestamp.toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /v1/rates/basket
 * For V=1 USD notional per ACBU: value share f_c = w_c/W over priced legs, local q_c = (V·f_c)/r_c.
 */
export async function getRatesBasket(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const basket = await basketService.getCurrentBasket();
    const one = await computeSyntheticBasketOneAcbuForBasket(basket, 1);
    if (!one) {
      res.status(200).json({
        usd_notional_per_acbu: 1,
        legs: [],
        message: "No priced basket legs; oracle must publish rates first.",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const usdValueSum = one.legs.reduce((s, leg) => s + leg.usdValueInLeg, 0);

    res.status(200).json({
      usd_notional_per_acbu: one.usdNotionalPerAcbu,
      legs: one.legs.map((leg) => ({
        currency: leg.currency,
        weight_percent: leg.weightPercent,
        effective_value_fraction: leg.effectiveValueFraction,
        usd_per_one_local: leg.usdPerLocal,
        local_per_one_acbu: leg.localPerOneAcbu,
        usd_value_in_leg: leg.usdValueInLeg,
      })),
      usd_value_sum: usdValueSum,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}
