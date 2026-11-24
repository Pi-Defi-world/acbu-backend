/**
 * Unit tests for the Stellar fee resolver (feeManager).
 * Covers: dynamic fetch success, dynamic fetch failure fallback, and static config path.
 */
const mockFetchBaseFee = jest.fn<Promise<number>, []>();

jest.mock("../client", () => ({
  stellarClient: {
    getServer: () => ({ fetchBaseFee: mockFetchBaseFee }),
  },
}));

jest.mock("../../../config/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../config/env", () => ({
  config: {
    stellar: {
      baseFeeStroops: 100,
      useDynamicFees: false,
    },
  },
}));

import { getBaseFee, applyFeeSurgeBuffer, getPaymentFee } from "../feeManager";
import { config } from "../../../config/env";

function setFeeConfig(baseFeeStroops: number, useDynamicFees: boolean) {
  config.stellar.baseFeeStroops = baseFeeStroops;
  config.stellar.useDynamicFees = useDynamicFees;
}

beforeEach(() => {
  jest.clearAllMocks();
  setFeeConfig(100, false);
});

describe("getBaseFee", () => {
  describe("when dynamic fees are disabled (default)", () => {
    it("returns the configured baseFeeStroops without calling Horizon", async () => {
      setFeeConfig(200, false);
      const fee = await getBaseFee();
      expect(fee).toBe("200");
      expect(mockFetchBaseFee).not.toHaveBeenCalled();
    });

    it("defaults to '100' when baseFeeStroops is 100", async () => {
      setFeeConfig(100, false);
      const fee = await getBaseFee();
      expect(fee).toBe("100");
    });
  });

  describe("when dynamic fees are enabled", () => {
    it("returns the Horizon-derived fee on successful fetch", async () => {
      setFeeConfig(100, true);
      mockFetchBaseFee.mockResolvedValueOnce(500);
      const fee = await getBaseFee();
      expect(fee).toBe("500");
      expect(mockFetchBaseFee).toHaveBeenCalledTimes(1);
    });

    it("falls back to configured baseFeeStroops when Horizon fetch throws", async () => {
      setFeeConfig(150, true);
      mockFetchBaseFee.mockRejectedValueOnce(new Error("network error"));
      const fee = await getBaseFee();
      expect(fee).toBe("150");
      expect(mockFetchBaseFee).toHaveBeenCalledTimes(1);
    });

    it("falls back when Horizon fetch rejects without a message", async () => {
      setFeeConfig(100, true);
      mockFetchBaseFee.mockRejectedValueOnce(undefined);
      await expect(getBaseFee()).resolves.toBe("100");
    });
  });
});

// AB-052 (#1002): the surge buffer + ceiling applied to a classic payment fee.
describe("applyFeeSurgeBuffer", () => {
  it("prices above the network base fee by the configured buffer", () => {
    const quote = applyFeeSurgeBuffer(100, 1_000_000, 2000);
    expect(quote).toEqual({
      feeStroops: 120,
      networkFeeStroops: 100,
      buffered: true,
      clampedToCeiling: false,
      maxFeeStroops: 1_000_000,
    });
  });

  it("rounds the buffered fee up so it never lands under the network fee", () => {
    // 103 * 1.1 = 113.3 — must round up, never down to 113.
    expect(applyFeeSurgeBuffer(103, 1_000_000, 1000).feeStroops).toBe(114);
  });

  it("applies no buffer when the buffer is zero", () => {
    const quote = applyFeeSurgeBuffer(250, 1_000_000, 0);
    expect(quote.feeStroops).toBe(250);
    expect(quote.buffered).toBe(false);
    expect(quote.clampedToCeiling).toBe(false);
  });

  it("clamps to the ceiling and flags the quote as unusable when the network fee exceeds it", () => {
    // 2_000_000 * 1.2 = 2_400_000, above the 1_000_000 ceiling: submitting this
    // fee is guaranteed to be rejected, so the caller must fail instead.
    const quote = applyFeeSurgeBuffer(2_000_000, 1_000_000, 2000);
    expect(quote.feeStroops).toBe(1_000_000);
    expect(quote.clampedToCeiling).toBe(true);
    // Still reported below the network's own base fee, which is the danger sign.
    expect(quote.feeStroops).toBeLessThan(quote.networkFeeStroops);
  });

  it("leaves an already-expensive fee untouched when it is under the ceiling", () => {
    const quote = applyFeeSurgeBuffer(900_000, 1_000_000, 2000);
    expect(quote.feeStroops).toBe(1_000_000);
    expect(quote.clampedToCeiling).toBe(true);
  });

  it("defaults the buffer and ceiling when the config object omits them", () => {
    // The mocked config only defines baseFeeStroops/useDynamicFees, so these
    // exercise the defensive fallbacks.
    const quote = applyFeeSurgeBuffer(100);
    expect(quote.feeStroops).toBe(120);
    expect(quote.maxFeeStroops).toBe(1_000_000);
  });

  it.each([
    ["NaN base fee", () => applyFeeSurgeBuffer(Number.NaN, 1000, 2000)],
    ["negative base fee", () => applyFeeSurgeBuffer(-1, 1000, 2000)],
    ["NaN ceiling", () => applyFeeSurgeBuffer(100, Number.NaN, 2000)],
    ["negative ceiling", () => applyFeeSurgeBuffer(100, -1, 2000)],
    ["NaN buffer", () => applyFeeSurgeBuffer(100, 1000, Number.NaN)],
    ["negative buffer", () => applyFeeSurgeBuffer(100, 1000, -5)],
  ])("rejects %s instead of producing a NaN fee", (_label, run) => {
    expect(run).toThrow(/Invalid Stellar/);
  });
});

describe("getPaymentFee", () => {
  it("resolves the buffered fee from the current base fee", async () => {
    setFeeConfig(500, false);
    const quote = await getPaymentFee();
    expect(quote.networkFeeStroops).toBe(500);
    expect(quote.feeStroops).toBe(600);
    expect(quote.clampedToCeiling).toBe(false);
  });

  it("fails loudly when the configured base fee is not a number", async () => {
    // Regression guard for AB-052: an undeclared STELLAR_BASE_FEE_STROOPS made
    // getBaseFee() return the string "undefined", which used to surface as
    // "[BigNumber Error] Not a number: undefined" from deep inside the builder.
    setFeeConfig("undefined" as unknown as number, false);
    await expect(getPaymentFee()).rejects.toThrow(/Stellar base fee is not a number/);
  });
});
