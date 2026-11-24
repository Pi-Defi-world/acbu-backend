/**
 * Basket service: current basket (currencies + weights) from DB.
 * Weights come from stats + DAO (BasketConfig), not hardcoded.
 * Fallback: if no active BasketConfig (e.g. before seed), uses DEFAULT_BASKET from config for seed compatibility.
 */
import { prisma } from "../../config/database";
import { BASKET_CURRENCIES, BASKET_WEIGHTS, BASKET_WEIGHT_BASIS_POINTS } from "../../config/basket";

export interface BasketEntry {
  currency: string;
  weight: number;
}

/** Fallback when DB has no active basket (e.g. before seed). Used only for compatibility; seed populates BasketConfig. */
function getDefaultBasket(): BasketEntry[] {
  return BASKET_CURRENCIES.map((c) => ({
    currency: c,
    weight: BASKET_WEIGHTS[c] ?? 0,
  }));
}

export class BasketService {
  /**
   * Get the current active basket (currencies + weights). Normalized so weights sum to 100.
   * Falls back to config defaults if no active BasketConfig in DB.
   */
  async getCurrentBasket(): Promise<BasketEntry[]> {
    const rows = await prisma.basketConfig.findMany({
      where: { status: "active" },
      orderBy: { effectiveFrom: "desc" },
    });

    if (rows.length === 0) {
      return getDefaultBasket();
    }

    const latestEffectiveFrom = rows[0].effectiveFrom;
    const currentRows = rows.filter(
      (r: (typeof rows)[0]) => r.effectiveFrom.getTime() === latestEffectiveFrom.getTime(),
    );

    const sum = currentRows.reduce(
      (s: number, r: (typeof currentRows)[0]) => s + r.weight.toNumber(),
      0,
    );

    // Validate that weights stored in DB sum exactly to 100.00% (10000 basis points).
    // Stored weights are Decimal(5,2) representing percent points; multiply by 100
    // to obtain basis points and compare after rounding to avoid floating noise.
    const sumBps = Math.round(sum * 100);
    if (sumBps !== BASKET_WEIGHT_BASIS_POINTS) {
      throw new Error(
        `Invalid active BasketConfig weights: sum ${sumBps} bps != expected ${BASKET_WEIGHT_BASIS_POINTS} bps`,
      );
    }

    return currentRows.map((r: (typeof currentRows)[0]) => ({
      currency: r.currency,
      weight: Math.round(r.weight.toNumber() * 100) / 100,
    }));
  }

  /**
   * Get basket effective at a given date (for history/replay).
   */
  async getBasketAsOf(date: Date): Promise<BasketEntry[]> {
    const rows = await prisma.basketConfig.findMany({
      where: {
        status: "active",
        effectiveFrom: { lte: date },
      },
      orderBy: { effectiveFrom: "desc" },
    });

    if (rows.length === 0) {
      return [];
    }

    const latestEffectiveFrom = rows[0].effectiveFrom;
    const asOfRows = rows.filter(
      (r: (typeof rows)[0]) => r.effectiveFrom.getTime() === latestEffectiveFrom.getTime(),
    );

    const sum = asOfRows.reduce((s: number, r: (typeof asOfRows)[0]) => s + r.weight.toNumber(), 0);

    const sumBps = Math.round(sum * 100);
    if (sumBps !== BASKET_WEIGHT_BASIS_POINTS) {
      throw new Error(
        `Invalid active BasketConfig weights as-of ${date.toISOString()}: sum ${sumBps} bps != expected ${BASKET_WEIGHT_BASIS_POINTS} bps`,
      );
    }

    return asOfRows.map((r: (typeof asOfRows)[0]) => ({
      currency: r.currency,
      weight: Math.round(r.weight.toNumber() * 100) / 100,
    }));
  }

  /**
   * Get target weight for a currency (from current basket). Returns 0 if currency not in basket.
   */
  async getTargetWeight(currency: string): Promise<number> {
    const basket = await this.getCurrentBasket();
    const entry = basket.find((e) => e.currency === currency);
    return entry?.weight ?? 0;
  }

  /**
   * Get list of currencies in current basket.
   */
  async getCurrencies(): Promise<string[]> {
    const basket = await this.getCurrentBasket();
    return basket.map((e) => e.currency);
  }
}

export const basketService = new BasketService();
