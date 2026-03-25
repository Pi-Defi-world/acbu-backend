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

import { getBaseFee } from "../feeManager";
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
