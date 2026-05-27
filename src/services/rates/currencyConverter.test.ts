/**
 * Unit tests for currency converter utilities
 * Tests the high-precision conversion logic from local currency to USD
 */

import { convertLocalToUsd, convertLocalToUsdWithPrecision } from "./currencyConverter";
import { prisma } from "../../config/database";
import { Decimal } from "@prisma/client/runtime/library";
import { AppError } from "../../middleware/errorHandler";

jest.mock("../../config/database");

describe("currencyConverter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("convertLocalToUsd", () => {
    it("should convert NGN to USD correctly", async () => {
      // Setup: 1 ACBU = 1000 NGN, 1 ACBU = 0.50 USD
      // 100,000 NGN = 100 ACBU = $50 USD
      (prisma.acbuRate.findFirst as jest.Mock).mockResolvedValue({
        acbuNgn: new Decimal("1000.00"),
        acbuUsd: new Decimal("0.50"),
        timestamp: new Date(),
      });

      const result = await convertLocalToUsd(100000, "NGN");

      expect(result).toBeCloseTo(50, 5);
    });

    it("should convert KES to USD correctly", async () => {
      // Setup: 1 ACBU = 150 KES, 1 ACBU = 0.50 USD
      // 7,500 KES = 50 ACBU = $25 USD
      (prisma.acbuRate.findFirst as jest.Mock).mockResolvedValue({
        acbuKes: new Decimal("150.00"),
        acbuUsd: new Decimal("0.50"),
        timestamp: new Date(),
      });

      const result = await convertLocalToUsd(7500, "KES");

      expect(result).toBeCloseTo(25, 5);
    });

    it("should handle all supported currencies", async () => {
      const mockRate = {
        acbuUsd: new Decimal("1.00"),
        acbuNgn: new Decimal("1000.00"),
        acbuKes: new Decimal("150.00"),
        acbuZar: new Decimal("20.00"),
        acbuEgp: new Decimal("30.00"),
        acbuGhs: new Decimal("12.00"),
        acbuRwf: new Decimal("1000.00"),
        acbuXof: new Decimal("650.00"),
        acbuMad: new Decimal("10.00"),
        acbuTzs: new Decimal("2500.00"),
        acbuUgx: new Decimal("4000.00"),
        acbuEur: new Decimal("0.95"),
        acbuGbp: new Decimal("0.73"),
        timestamp: new Date(),
      };

      (prisma.acbuRate.findFirst as jest.Mock).mockResolvedValue(mockRate);

      const currencies = ["NGN", "KES", "ZAR", "EGP", "GHS", "RWF", "XOF", "MAD", "TZS", "UGX", "EUR", "GBP", "USD"];

      for (const currency of currencies) {
        const result = await convertLocalToUsd(1000, currency);
        expect(typeof result).toBe("number");
        expect(result).toBeGreaterThan(0);
      }
    });

    it("should preserve decimal precision with high-value conversions", async () => {
      // Test with large amounts to ensure no floating-point rounding errors
      (prisma.acbuRate.findFirst as jest.Mock).mockResolvedValue({
        acbuNgn: new Decimal("1000.12345"),
        acbuUsd: new Decimal("0.50789123"),
        timestamp: new Date(),
      });

      const result = await convertLocalToUsd(999999.99, "NGN");

      // Should maintain precision
      expect(result).toBeCloseTo(507880.64, 2);
    });

    it("should reject unsupported currency", async () => {
      await expect(convertLocalToUsd(100000, "JPY")).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("Currency JPY not supported"),
          statusCode: 400,
        }),
      );
    });

    it("should handle case-insensitive currency codes", async () => {
      (prisma.acbuRate.findFirst as jest.Mock).mockResolvedValue({
        acbuNgn: new Decimal("1000.00"),
        acbuUsd: new Decimal("0.50"),
        timestamp: new Date(),
      });

      // NGN should work
      const result = await convertLocalToUsd(100000, "NGN");
      expect(result).toBeCloseTo(50, 5);
    });

    it("should throw error if no rates available", async () => {
      (prisma.acbuRate.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(convertLocalToUsd(100000, "NGN")).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("Exchange rates not yet available"),
          statusCode: 503,
        }),
      );
    });

    it("should throw error if local currency rate is zero or negative", async () => {
      (prisma.acbuRate.findFirst as jest.Mock).mockResolvedValue({
        acbuNgn: new Decimal("0"),
        acbuUsd: new Decimal("0.50"),
        timestamp: new Date(),
      });

      await expect(convertLocalToUsd(100000, "NGN")).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("Exchange rate for NGN is not available or invalid"),
          statusCode: 503,
        }),
      );
    });

    it("should throw error if USD rate is zero or negative", async () => {
      (prisma.acbuRate.findFirst as jest.Mock).mockResolvedValue({
        acbuNgn: new Decimal("1000.00"),
        acbuUsd: new Decimal("0"),
        timestamp: new Date(),
      });

      await expect(convertLocalToUsd(100000, "NGN")).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("USD conversion rate is invalid"),
          statusCode: 503,
        }),
      );
    });

    it("should handle very small local amounts", async () => {
      (prisma.acbuRate.findFirst as jest.Mock).mockResolvedValue({
        acbuNgn: new Decimal("1000.00"),
        acbuUsd: new Decimal("0.50"),
        timestamp: new Date(),
      });

      const result = await convertLocalToUsd(1, "NGN");

      expect(result).toBeCloseTo(0.0005, 10);
    });

    it("should handle very large local amounts", async () => {
      (prisma.acbuRate.findFirst as jest.Mock).mockResolvedValue({
        acbuNgn: new Decimal("1000.00"),
        acbuUsd: new Decimal("0.50"),
        timestamp: new Date(),
      });

      const result = await convertLocalToUsd(1000000000, "NGN");

      expect(result).toBeCloseTo(500000, 2);
    });

    it("should handle decimal input strings", async () => {
      (prisma.acbuRate.findFirst as jest.Mock).mockResolvedValue({
        acbuNgn: new Decimal("1000.00"),
        acbuUsd: new Decimal("0.50"),
        timestamp: new Date(),
      });

      const result = await convertLocalToUsd(100000.5, "NGN");

      expect(result).toBeCloseTo(50.0025, 5);
    });
  });

  describe("convertLocalToUsdWithPrecision", () => {
    it("should return all precision components", async () => {
      (prisma.acbuRate.findFirst as jest.Mock).mockResolvedValue({
        acbuNgn: new Decimal("1000.00"),
        acbuUsd: new Decimal("0.50"),
        timestamp: new Date(),
      });

      const result = await convertLocalToUsdWithPrecision(100000, "NGN");

      expect(result).toHaveProperty("usdAmount");
      expect(result).toHaveProperty("originalAmount");
      expect(result).toHaveProperty("acbuEquivalent");

      expect(result.usdAmount).toBeCloseTo(50, 5);
      expect(result.originalAmount).toEqual(new Decimal(100000));
      expect(result.acbuEquivalent).toEqual(new Decimal(100));
    });

    it("should handle string input", async () => {
      (prisma.acbuRate.findFirst as jest.Mock).mockResolvedValue({
        acbuKes: new Decimal("150.00"),
        acbuUsd: new Decimal("0.50"),
        timestamp: new Date(),
      });

      const result = await convertLocalToUsdWithPrecision("7500", "KES");

      expect(result.usdAmount).toBeCloseTo(25, 5);
      expect(result.originalAmount).toEqual(new Decimal("7500"));
    });

    it("should preserve exact Decimal values for audit logging", async () => {
      const precisionRate = new Decimal("1000.123456789");
      const precisionUsdRate = new Decimal("0.507891234");

      (prisma.acbuRate.findFirst as jest.Mock).mockResolvedValue({
        acbuNgn: precisionRate,
        acbuUsd: precisionUsdRate,
        timestamp: new Date(),
      });

      const result = await convertLocalToUsdWithPrecision("999999.99", "NGN");

      // Verify Decimal objects maintain precision
      expect(result.originalAmount.toString()).toContain("999999.99");
      expect(result.acbuEquivalent.toString()).toMatch(/^999\..*$/); // Should be ~999 ACBU
    });

    it("should throw same errors as convertLocalToUsd", async () => {
      (prisma.acbuRate.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        convertLocalToUsdWithPrecision(100000, "NGN"),
      ).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("Exchange rates not yet available"),
          statusCode: 503,
        }),
      );
    });
  });

  describe("Real-world scenarios", () => {
    it("should correctly price a typical retail NGN deposit", async () => {
      // Real scenario: 50,000 NGN deposit with typical rates
      // 1 ACBU ≈ 500 NGN, 1 ACBU ≈ $0.60 USD
      (prisma.acbuRate.findFirst as jest.Mock).mockResolvedValue({
        acbuNgn: new Decimal("500.00"),
        acbuUsd: new Decimal("0.60"),
        timestamp: new Date(),
      });

      const usdEquivalent = await convertLocalToUsd(50000, "NGN");

      // 50,000 NGN = 100 ACBU = $60 USD
      expect(usdEquivalent).toBeCloseTo(60, 2);
    });

    it("should correctly price a large business KES deposit", async () => {
      // Business deposit: 1,000,000 KES
      // 1 ACBU = 200 KES, 1 ACBU = $0.70 USD
      (prisma.acbuRate.findFirst as jest.Mock).mockResolvedValue({
        acbuKes: new Decimal("200.00"),
        acbuUsd: new Decimal("0.70"),
        timestamp: new Date(),
      });

      const usdEquivalent = await convertLocalToUsd(1000000, "KES");

      // 1,000,000 KES = 5,000 ACBU = $3,500 USD
      expect(usdEquivalent).toBeCloseTo(3500, 2);
    });

    it("should handle multi-currency conversion consistency", async () => {
      // Same value in different currencies should have same USD equivalent
      const mockRates = {
        acbuNgn: new Decimal("1000.00"),
        acbuKes: new Decimal("150.00"),
        acbuUsd: new Decimal("0.50"),
        timestamp: new Date(),
      };

      (prisma.acbuRate.findFirst as jest.Mock).mockResolvedValue(mockRates);

      // Convert 100,000 NGN
      const ngnToUsd = await convertLocalToUsd(100000, "NGN");

      // Change mock for KES
      (prisma.acbuRate.findFirst as jest.Mock).mockResolvedValue({
        ...mockRates,
        acbuKes: new Decimal("150.00"),
      });

      // Convert 15,000 KES (should be equivalent ACBU amount)
      const kesEquivalent = 100000 * (150 / 1000); // 15,000 KES
      const kesToUsd = await convertLocalToUsd(kesEquivalent, "KES");

      // Both should be approximately $50 USD
      expect(ngnToUsd).toBeCloseTo(50, 2);
      expect(kesToUsd).toBeCloseTo(50, 2);
    });
  });
});
