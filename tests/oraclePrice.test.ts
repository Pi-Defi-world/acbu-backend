import {
  OraclePriceError,
  assertPositiveOraclePrice,
  assertValidUpdateReservePayload,
  computeReserveValueUsd,
} from "../src/services/contracts/oraclePrice";

const SCALE = 10_000_000n;

describe("oracle price validation (W11-CAR-030)", () => {
  describe("assertPositiveOraclePrice", () => {
    it("accepts a strictly positive atomic price", () => {
      expect(assertPositiveOraclePrice(1_500_000n, "NGN")).toBe(1_500_000n);
      expect(assertPositiveOraclePrice("1500000", "NGN")).toBe(1500000n);
    });

    it("rejects zero oracle price", () => {
      expect(() => assertPositiveOraclePrice(0n, "NGN")).toThrow(OraclePriceError);
    });

    it("rejects negative oracle price", () => {
      expect(() => assertPositiveOraclePrice(-5n, "KES")).toThrow(OraclePriceError);
    });

    it("rejects missing oracle price", () => {
      expect(() => assertPositiveOraclePrice(null, "RWF")).toThrow(OraclePriceError);
      expect(() => assertPositiveOraclePrice(undefined, "RWF")).toThrow(OraclePriceError);
    });

    it("rejects non-numeric oracle price", () => {
      expect(() => assertPositiveOraclePrice("not-a-number", "NGN")).toThrow(OraclePriceError);
    });
  });

  describe("computeReserveValueUsd", () => {
    it("computes value with checked math at 7-decimal scale", () => {
      // 100 units at 0.015 USD/unit -> 1.5 USD
      const amount = 100n * SCALE;
      const price = 150_000n; // 0.015 in 7-dec
      expect(computeReserveValueUsd(amount, price, "NGN")).toBe(15_000_000n);
    });

    it("returns zero value only for zero custody amount with a valid price", () => {
      expect(computeReserveValueUsd(0n, 150_000n, "NGN")).toBe(0n);
    });

    it("throws on zero oracle price instead of producing a zero-valued reserve", () => {
      expect(() => computeReserveValueUsd(100n * SCALE, 0n, "NGN")).toThrow(OraclePriceError);
    });

    it("throws on negative custody amount", () => {
      expect(() => computeReserveValueUsd(-1n, 150_000n, "NGN")).toThrow(OraclePriceError);
    });
  });

  describe("assertValidUpdateReservePayload", () => {
    it("accepts zero amount with zero value", () => {
      expect(() => assertValidUpdateReservePayload(0n, 0n, "NGN")).not.toThrow();
    });

    it("accepts positive amount with positive value", () => {
      expect(() => assertValidUpdateReservePayload(100n * SCALE, 15_000_000n, "NGN")).not.toThrow();
    });

    it("rejects positive amount with zero value (zero/missing oracle price)", () => {
      expect(() => assertValidUpdateReservePayload(100n * SCALE, 0n, "NGN")).toThrow(
        OraclePriceError,
      );
    });

    it("rejects negative amount", () => {
      expect(() => assertValidUpdateReservePayload(-1n, 100n, "NGN")).toThrow(OraclePriceError);
    });

    it("rejects negative value", () => {
      expect(() => assertValidUpdateReservePayload(100n, -1n, "NGN")).toThrow(OraclePriceError);
    });
  });
});
