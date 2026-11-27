/**
 * Integration test scenarios for cross-border currency conversion slippage (W11-AUD-019).
 *
 * Tests assert behavior when exchange rates shift > 3% mid-transaction and
 * verify that slippage bounds enforcement catches volatile rate conditions
 * before they result in partially-funded or under-valued transactions.
 */

import { isSlippageExceedingBound } from "../src/services/rates/slippageGuard";
import {
  invalidateExchangeRateCache,
  setCachedExchangeRate,
  getCachedExchangeRate,
  isReasonableExchangeRate,
} from "../src/services/rates/exchangeRateService";

jest.mock("../src/config/logger", () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

beforeEach(() => {
  invalidateExchangeRateCache();
});

describe("W11-AUD-019 — isSlippageExceedingBound", () => {
  describe("slippage within tolerance", () => {
    it("accepts 0% rate change", () => {
      const result = isSlippageExceedingBound({
        rateAtQuote: 0.0007,
        rateAtExecution: 0.0007,
        maxSlippagePct: 3,
      });
      expect(result.exceeded).toBe(false);
      expect(result.slippagePct).toBe(0);
    });

    it("accepts a 1% rate decrease (within 3% bound)", () => {
      const result = isSlippageExceedingBound({
        rateAtQuote: 0.0007,
        rateAtExecution: 0.0007 * 0.99,
        maxSlippagePct: 3,
      });
      expect(result.exceeded).toBe(false);
      expect(result.slippagePct).toBeCloseTo(1, 1);
    });

    it("accepts a 1% rate increase (within 3% bound)", () => {
      const result = isSlippageExceedingBound({
        rateAtQuote: 0.0007,
        rateAtExecution: 0.0007 * 1.01,
        maxSlippagePct: 3,
      });
      expect(result.exceeded).toBe(false);
      expect(result.slippagePct).toBeCloseTo(1, 1);
    });

    it("does not exceed bound at exactly 3%", () => {
      const result = isSlippageExceedingBound({
        rateAtQuote: 1.0,
        rateAtExecution: 1.03,
        maxSlippagePct: 3,
      });
      expect(result.exceeded).toBe(false);
      expect(result.slippagePct).toBeCloseTo(3, 5);
    });
  });

  describe("slippage exceeding tolerance (> 3% shift)", () => {
    it("rejects a 3.1% rate decrease", () => {
      const result = isSlippageExceedingBound({
        rateAtQuote: 0.0007,
        rateAtExecution: 0.0007 * (1 - 0.031),
        maxSlippagePct: 3,
      });
      expect(result.exceeded).toBe(true);
      expect(result.slippagePct).toBeCloseTo(3.1, 1);
    });

    it("rejects a 3.1% rate increase (favourable but potentially unreliable feed)", () => {
      const result = isSlippageExceedingBound({
        rateAtQuote: 0.0007,
        rateAtExecution: 0.0007 * 1.031,
        maxSlippagePct: 3,
      });
      expect(result.exceeded).toBe(true);
      expect(result.slippagePct).toBeCloseTo(3.1, 1);
    });

    it("rejects a 5% mid-transaction NGN/USD rate drop", () => {
      const rateAtQuote = 0.00065;
      const rateAtExecution = rateAtQuote * 0.95; // NGN weakens 5% against USD

      const result = isSlippageExceedingBound({ rateAtQuote, rateAtExecution, maxSlippagePct: 3 });
      expect(result.exceeded).toBe(true);
      expect(result.slippagePct).toBeCloseTo(5, 1);
    });

    it("rejects a 10% extreme volatility scenario (KES/ACBU spike)", () => {
      const result = isSlippageExceedingBound({
        rateAtQuote: 150,
        rateAtExecution: 165, // 10% spike
        maxSlippagePct: 3,
      });
      expect(result.exceeded).toBe(true);
      expect(result.slippagePct).toBeCloseTo(10, 1);
    });

    it("rejects a 50% crash scenario (NGN devaluation event)", () => {
      const result = isSlippageExceedingBound({
        rateAtQuote: 1000,
        rateAtExecution: 1500, // 50% spike
        maxSlippagePct: 3,
      });
      expect(result.exceeded).toBe(true);
      expect(result.slippagePct).toBeCloseTo(50, 1);
    });
  });

  describe("custom slippage bounds", () => {
    it("respects a tighter 1% bound", () => {
      const result = isSlippageExceedingBound({
        rateAtQuote: 1.0,
        rateAtExecution: 1.015, // 1.5% shift
        maxSlippagePct: 1,
      });
      expect(result.exceeded).toBe(true);
      expect(result.slippagePct).toBeCloseTo(1.5, 1);
    });

    it("respects a looser 10% bound", () => {
      const result = isSlippageExceedingBound({
        rateAtQuote: 1.0,
        rateAtExecution: 1.09, // 9% shift
        maxSlippagePct: 10,
      });
      expect(result.exceeded).toBe(false);
      expect(result.slippagePct).toBeCloseTo(9, 1);
    });

    it("zero bound rejects any rate change", () => {
      const result = isSlippageExceedingBound({
        rateAtQuote: 1.0,
        rateAtExecution: 1.001,
        maxSlippagePct: 0,
      });
      expect(result.exceeded).toBe(true);
    });
  });

  describe("input validation", () => {
    it("throws when rateAtQuote is zero", () => {
      expect(() =>
        isSlippageExceedingBound({ rateAtQuote: 0, rateAtExecution: 1, maxSlippagePct: 3 }),
      ).toThrow(/rateAtQuote/);
    });

    it("throws when rateAtQuote is negative", () => {
      expect(() =>
        isSlippageExceedingBound({ rateAtQuote: -1, rateAtExecution: 1, maxSlippagePct: 3 }),
      ).toThrow(/rateAtQuote/);
    });

    it("throws when rateAtExecution is zero", () => {
      expect(() =>
        isSlippageExceedingBound({ rateAtQuote: 1, rateAtExecution: 0, maxSlippagePct: 3 }),
      ).toThrow(/rateAtExecution/);
    });

    it("throws when rateAtExecution is negative", () => {
      expect(() =>
        isSlippageExceedingBound({ rateAtQuote: 1, rateAtExecution: -5, maxSlippagePct: 3 }),
      ).toThrow(/rateAtExecution/);
    });

    it("throws when maxSlippagePct is negative", () => {
      expect(() =>
        isSlippageExceedingBound({ rateAtQuote: 1, rateAtExecution: 1, maxSlippagePct: -1 }),
      ).toThrow(/maxSlippagePct/);
    });

    it("throws when rateAtQuote is Infinity", () => {
      expect(() =>
        isSlippageExceedingBound({ rateAtQuote: Infinity, rateAtExecution: 1, maxSlippagePct: 3 }),
      ).toThrow(/rateAtQuote/);
    });

    it("throws when rateAtExecution is NaN", () => {
      expect(() =>
        isSlippageExceedingBound({ rateAtQuote: 1, rateAtExecution: NaN, maxSlippagePct: 3 }),
      ).toThrow(/rateAtExecution/);
    });
  });
});

describe("W11-AUD-019 — Exchange rate cache behavior under rate shifts", () => {
  it("serves stale cached rate after a volatile shift (documents cache lag risk)", () => {
    // Rate is cached at quote time
    setCachedExchangeRate("NGN", 0.0007, true);
    expect(getCachedExchangeRate("NGN")).toBe(0.0007);

    // Mid-transaction the real rate drops 5% but the cache still serves the old value.
    // This documents the window where slippage can occur without proactive invalidation.
    const cachedRate = getCachedExchangeRate("NGN")!;
    const executionRate = 0.0007 * 0.95;

    const slippage = isSlippageExceedingBound({
      rateAtQuote: cachedRate,
      rateAtExecution: executionRate,
      maxSlippagePct: 3,
    });

    expect(slippage.exceeded).toBe(true);
    expect(slippage.slippagePct).toBeCloseTo(5, 1);
  });

  it("detects no slippage risk after cache is invalidated and refreshed with the new rate", () => {
    setCachedExchangeRate("KES", 0.0075, true);

    // Invalidate and re-populate with the shifted rate (3% drop — within tolerance)
    invalidateExchangeRateCache("KES");
    const newRate = 0.0075 * 0.97;
    setCachedExchangeRate("KES", newRate, true);

    const cached = getCachedExchangeRate("KES")!;
    const slippage = isSlippageExceedingBound({
      rateAtQuote: 0.0075,
      rateAtExecution: cached,
      maxSlippagePct: 3,
    });

    expect(slippage.exceeded).toBe(false);
  });

  it("isReasonableExchangeRate rejects extreme outlier rates from a feed error", () => {
    expect(isReasonableExchangeRate(0)).toBe(false);
    expect(isReasonableExchangeRate(-1)).toBe(false);
    expect(isReasonableExchangeRate(1e-10)).toBe(false); // below min bound
    expect(isReasonableExchangeRate(2_000_000)).toBe(false); // above max bound
    expect(isReasonableExchangeRate(0.0007)).toBe(true); // normal NGN/USD rate
    expect(isReasonableExchangeRate(150)).toBe(true); // normal KES/ACBU rate
  });

  describe("multi-step conversion flow with mid-flight rate changes", () => {
    it("detects slippage when rate changes > 3% between quote step and execution step", () => {
      const quoteRate = 0.00065; // NGN/USD at quote time
      const executionRate = quoteRate * (1 - 0.045); // 4.5% adverse shift before execution

      const check = isSlippageExceedingBound({
        rateAtQuote: quoteRate,
        rateAtExecution: executionRate,
        maxSlippagePct: 3,
      });

      expect(check.exceeded).toBe(true);
      expect(check.slippagePct).toBeCloseTo(4.5, 1);
    });

    it("does not flag slippage for normal intra-day NGN fluctuation (< 1%)", () => {
      const quoteRate = 0.00065;
      const executionRate = quoteRate * 0.998; // 0.2% drift

      const check = isSlippageExceedingBound({
        rateAtQuote: quoteRate,
        rateAtExecution: executionRate,
        maxSlippagePct: 3,
      });

      expect(check.exceeded).toBe(false);
      expect(check.slippagePct).toBeCloseTo(0.2, 1);
    });

    it("detects slippage in KES multi-step flow with a 6% rate spike between steps", () => {
      const rateStep1 = 150.5; // KES/ACBU at step 1
      const rateStep2 = rateStep1 * 1.06; // 6% adverse movement at step 2

      const check = isSlippageExceedingBound({
        rateAtQuote: rateStep1,
        rateAtExecution: rateStep2,
        maxSlippagePct: 3,
      });

      expect(check.exceeded).toBe(true);
      expect(check.slippagePct).toBeCloseTo(6, 1);
    });

    it("leaves a ZAR transaction unrecoverable when a 15% crash is not checked", () => {
      // Documents the unrecoverable partially-funded state described in W11-AUD-019.
      // A transaction quoted at rateAtQuote would need slippage enforcement to abort
      // rather than proceed and leave the user short-funded.
      const rateAtQuote = 0.055; // ZAR/USD
      const rateAtExecution = rateAtQuote * 0.85; // 15% ZAR crash mid-transaction

      const check = isSlippageExceedingBound({
        rateAtQuote,
        rateAtExecution,
        maxSlippagePct: 3,
      });

      expect(check.exceeded).toBe(true);
      expect(check.slippagePct).toBeCloseTo(15, 1);
    });
  });
});
