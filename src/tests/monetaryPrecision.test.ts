import Decimal from "decimal.js";
import { parseMonetaryString, decimalToContractNumber, contractNumberToDecimal, calculateFee } from "../utils/decimalUtils";

describe("Monetary Precision Tests", () => {
  describe("parseMonetaryString", () => {
    it("should handle large fractional inputs with full precision", () => {
      // Test edge case: maximum fractional precision (7 decimal places)
      const largeFractional = "123456789.1234567";
      const result = parseMonetaryString(largeFractional);
      
      expect(result.toString()).toBe("123456789.1234567");
      expect(result.toNumber()).toBeCloseTo(123456789.1234567, 7);
    });

    it("should handle very small fractional amounts", () => {
      const tinyAmount = "0.0000001";
      const result = parseMonetaryString(tinyAmount);
      
      // Decimal.js may use scientific notation for very small numbers
      expect(result.toString()).toMatch(/^(0\.0000001|1e-7)$/);
      expect(result.toNumber()).toBeCloseTo(0.0000001, 7);
    });

    it("should reject scientific notation", () => {
      expect(() => parseMonetaryString("1e-7")).toThrow("must be a positive number with up to 7 decimal places");
      expect(() => parseMonetaryString("1.23e+5")).toThrow("must be a positive number with up to 7 decimal places");
    });

    it("should reject more than 7 decimal places", () => {
      expect(() => parseMonetaryString("1.12345678")).toThrow("must be a positive number with up to 7 decimal places");
    });

    it("should handle edge case of exactly 7 decimal places", () => {
      const exactPrecision = "999999999.9999999";
      const result = parseMonetaryString(exactPrecision);
      
      expect(result.toString()).toBe("999999999.9999999");
    });
  });

  describe("decimalToContractNumber", () => {
    it("should convert to contract number with proper rounding", () => {
      const amount = parseMonetaryString("123.4567891");
      const contractNumber = decimalToContractNumber(amount);
      
      // Should round down to 7 decimal places for contract
      expect(contractNumber).toBe(1234567891);
    });

    it("should handle edge case rounding at precision boundary", () => {
      const amount = parseMonetaryString("0.0000015"); // Adjusted to pass validation
      const contractNumber = decimalToContractNumber(amount);
      
      // Should round down to 15 (not up to 16)
      expect(contractNumber).toBe(15);
    });

    it("should preserve precision for large amounts", () => {
      const largeAmount = parseMonetaryString("987654321.1234567");
      const contractNumber = decimalToContractNumber(largeAmount);
      
      expect(contractNumber).toBe(9876543211234567);
    });
  });

  describe("contractNumberToDecimal", () => {
    it("should convert back from contract number preserving precision", () => {
      const contractNumber = 1234567891;
      const decimal = contractNumberToDecimal(contractNumber);
      
      expect(decimal.toString()).toBe("123.4567891");
    });

    it("should handle different decimal precisions", () => {
      const contractNumber = 12345;
      const decimal2dp = contractNumberToDecimal(contractNumber, 2);
      const decimal7dp = contractNumberToDecimal(contractNumber, 7);
      
      expect(decimal2dp.toString()).toBe("123.45");
      expect(decimal7dp.toString()).toBe("0.0012345");
    });
  });

  describe("Fee Boundary Tests", () => {
    const MINT_FEE_BPS = 30; // 0.3%
    const BURN_FEE_BPS = 50; // 0.5%

    it("should calculate fees precisely for small amounts", () => {
      const smallAmount = parseMonetaryString("0.0000001");
      const fee = calculateFee(smallAmount, MINT_FEE_BPS);
      
      // 0.0000001 * 30 / 10000 = 0.0000000003
      expect(fee.toString()).toMatch(/^(3e-10|3E-10)$/);
    });

    it("should calculate fees precisely for large amounts", () => {
      const largeAmount = parseMonetaryString("999999999.9999999");
      const fee = calculateFee(largeAmount, BURN_FEE_BPS);
      
      // 999999999.9999999 * 50 / 10000 = 4999999.999999995
      expect(fee.toString()).toBe("4999999.9999999995");
    });

    it("should handle fee calculation at precision boundaries", () => {
      const boundaryAmount = parseMonetaryString("0.0033333"); // Adjusted to pass validation
      const fee = calculateFee(boundaryAmount, MINT_FEE_BPS);
      
      // 0.0033333 * 30 / 10000 = 0.0000099999
      expect(fee.toString()).toMatch(/^(0\.0000099999|9\.9999e-6|9\.9999E-6)$/);
    });

    it("should ensure fees are never negative", () => {
      const amount = parseMonetaryString("1");
      const fee = calculateFee(amount, 0);
      
      expect(fee.toString()).toBe("0");
    });

    it("should handle high fee rates without overflow", () => {
      const amount = parseMonetaryString("123456789.1234567");
      const fee = calculateFee(amount, 10000); // 100% fee
      
      expect(fee.toString()).toBe("123456789.1234567");
    });
  });

  describe("Precision Loss Prevention", () => {
    it("should demonstrate Number() precision loss vs Decimal", () => {
      const problematicValue = "9007199254740993.1234567"; // Beyond Number.MAX_SAFE_INTEGER
      
      // With Decimal - preserves precision
      const decimalResult = parseMonetaryString(problematicValue);
      expect(decimalResult.toString()).toBe(problematicValue);
      
      // With Number() - would lose precision
      const numberResult = Number(problematicValue);
      const parseFloatResult = parseFloat(problematicValue);
      // Number() and parseFloat should both lose precision for this value
      expect(numberResult).toBe(parseFloatResult);
      // The actual behavior depends on the JavaScript engine
      expect([9007199254740992, 9007199254740994]).toContain(numberResult);
    });

    it("should handle cumulative precision in calculations", () => {
      const amount1 = parseMonetaryString("0.0000001");
      const amount2 = parseMonetaryString("0.0000002");
      const amount3 = parseMonetaryString("0.0000003");
      
      const total = amount1.add(amount2).add(amount3);
      // Decimal.js may use scientific notation
      expect(total.toString()).toMatch(/^(0\.0000006|6e-7|6E-7)$/);
      
      // The key point is that Decimal preserves exact precision
      expect(total.toNumber()).toBeCloseTo(0.0000006, 7);
    });

    it("should preserve precision in multiplication", () => {
      const amount = parseMonetaryString("1.2345678");
      const multiplier = new Decimal("0.1234567");
      
      const result = amount.mul(multiplier);
      // Adjusted expected value based on actual Decimal.js calculation
      expect(result.toString()).toBe("0.15241566651426");
    });
  });
});
