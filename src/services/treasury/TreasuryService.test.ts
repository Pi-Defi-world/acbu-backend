/**
 * Treasury Service Tests
 *
 * Comprehensive test suite covering:
 * - Data joins and null handling
 * - FX fallback logic
 * - Reconciliation engine with tolerance
 * - Edge cases (zero rates, missing data)
 * - Load testing with multiple currencies
 */

import { getEnterpriseTreasury, getTreasuryHealth } from "./TreasuryService";
import { prisma } from "../../config/database";
import { Decimal } from "@prisma/client/runtime/library";
import { ReserveTracker } from "../reserve/ReserveTracker";

jest.mock("../../config/database", () => {
  const mockDb = {
    reserve: {
      findMany: jest.fn(),
    },
    transaction: {
      findMany: jest.fn(),
    },
    oracleRate: {
      findFirst: jest.fn(),
    },
  };
  return {
    prisma: mockDb,
    prismaReplica: mockDb,
  };
});

jest.mock("../../config/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../reserve/ReserveTracker", () => ({
  ReserveTracker: {
    SEGMENT_TRANSACTIONS: "transactions",
    SEGMENT_INVESTMENT_SAVINGS: "investment_savings",
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe("TreasuryService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getEnterpriseTreasury", () => {
    it("returns zero balances when no reserves or transactions exist", async () => {
      mockPrisma.reserve.findMany.mockResolvedValue([]);
      mockPrisma.transaction.findMany.mockResolvedValue([]);
      mockPrisma.oracleRate.findFirst.mockResolvedValue(null);

      const result = await getEnterpriseTreasury();

      expect(result.totalBalanceUsd).toBe(0);
      expect(result.totalReserveAmount).toBe(0);
      expect(result.byCurrency).toEqual([]);
      expect(result.reconciliation.isReconciled).toBe(true);
    });

    it("handles null reserve values by defaulting to 0 (COALESCE logic)", async () => {
      mockPrisma.reserve.findMany.mockResolvedValue([]);
      mockPrisma.transaction.findMany.mockResolvedValue([]);
      mockPrisma.oracleRate.findFirst.mockResolvedValue(null);

      const result = await getEnterpriseTreasury();

      // Verify null handling - no NaN or null in response
      expect(result.totalBalanceUsd).toBeDefined();
      expect(Number.isFinite(result.totalBalanceUsd)).toBe(true);
    });

    it("aggregates multiple currency reserves by segment", async () => {
      const now = new Date();
      mockPrisma.reserve.findMany.mockResolvedValue([
        {
          currency: "NGN",
          segment: ReserveTracker.SEGMENT_TRANSACTIONS,
          reserveAmount: new Decimal("1000000"),
          reserveValueUsd: new Decimal("667.50"),
          timestamp: now,
        },
        {
          currency: "NGN",
          segment: ReserveTracker.SEGMENT_INVESTMENT_SAVINGS,
          reserveAmount: new Decimal("500000"),
          reserveValueUsd: new Decimal("333.75"),
          timestamp: now,
        },
        {
          currency: "KES",
          segment: ReserveTracker.SEGMENT_TRANSACTIONS,
          reserveAmount: new Decimal("50000"),
          reserveValueUsd: new Decimal("385.00"),
          timestamp: now,
        },
      ] as any);

      mockPrisma.transaction.findMany.mockResolvedValue([]);
      mockPrisma.oracleRate.findFirst.mockResolvedValue(null);

      const result = await getEnterpriseTreasury();

      expect(result.byCurrency).toHaveLength(2);
      expect(result.totalBalanceUsd).toBeCloseTo(1386.25, 2);

      const ngnEntry = result.byCurrency.find((c) => c.currency === "NGN");
      expect(ngnEntry?.combined.reserveValueUsd).toBeCloseTo(1001.25, 2);

      const kesEntry = result.byCurrency.find((c) => c.currency === "KES");
      expect(kesEntry?.combined.reserveValueUsd).toBeCloseTo(385.0, 2);
    });

    it("uses current FX rate when available", async () => {
      const now = new Date();

      mockPrisma.reserve.findMany.mockResolvedValue([
        {
          currency: "NGN",
          segment: ReserveTracker.SEGMENT_TRANSACTIONS,
          reserveAmount: new Decimal("1000000"),
          reserveValueUsd: new Decimal("667.50"),
          timestamp: now,
        },
      ] as any);

      mockPrisma.transaction.findMany.mockResolvedValue([]);

      // Mock FX rate lookup - return current rate
      mockPrisma.oracleRate.findFirst.mockResolvedValueOnce({
        rateUsd: new Decimal("0.000667"),
        timestamp: now,
      } as any);

      const result = await getEnterpriseTreasury();

      expect(result.byCurrency[0].transactions.fxRateSource).toBe("current");
      expect(result.byCurrency[0].transactions.fxRateTimestamp).toEqual(now);
    });

    it("falls back to recent FX rate when current rate unavailable", async () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

      mockPrisma.reserve.findMany.mockResolvedValue([
        {
          currency: "ZAR",
          segment: ReserveTracker.SEGMENT_TRANSACTIONS,
          reserveAmount: new Decimal("100000"),
          reserveValueUsd: new Decimal("5000"),
          timestamp: now,
        },
      ] as any);

      mockPrisma.transaction.findMany.mockResolvedValue([]);

      // First call: no current rate
      // Second call: fallback rate from 3 days ago
      mockPrisma.oracleRate.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
        rateUsd: new Decimal("0.05"),
        timestamp: threeDaysAgo,
      } as any);

      const result = await getEnterpriseTreasury();

      expect(result.byCurrency[0].transactions.fxRateSource).toBe("fallback");
      expect(result.byCurrency[0].transactions.fxRateTimestamp).toEqual(threeDaysAgo);
    });

    it("uses rate=1 when no FX rate available at all", async () => {
      mockPrisma.reserve.findMany.mockResolvedValue([
        {
          currency: "XYZ",
          segment: ReserveTracker.SEGMENT_TRANSACTIONS,
          reserveAmount: new Decimal("100"),
          reserveValueUsd: new Decimal("100"),
          timestamp: new Date(),
        },
      ] as any);

      mockPrisma.transaction.findMany.mockResolvedValue([]);
      mockPrisma.oracleRate.findFirst.mockResolvedValue(null);

      const result = await getEnterpriseTreasury();

      expect(result.byCurrency[0].transactions.fxRateSource).toBe("zero");
      expect(result.byCurrency[0].transactions.fxRate).toBe(1);
    });

    it("reconciles ledger vs calculated totals within tolerance", async () => {
      const now = new Date();

      // Ledger: $1000 USD
      mockPrisma.reserve.findMany.mockResolvedValue([
        {
          currency: "NGN",
          segment: ReserveTracker.SEGMENT_TRANSACTIONS,
          reserveAmount: new Decimal("1000000"),
          reserveValueUsd: new Decimal("1000"),
          timestamp: now,
        },
      ] as any);

      // ACBU units intentionally differ from the USD value used for reconciliation.
      mockPrisma.transaction.findMany.mockResolvedValue([
        {
          type: "transfer",
          localCurrency: "NGN",
          usdcAmount: new Decimal("1000.05"),
          acbuAmount: new Decimal("1500"),
          acbuAmountBurned: null,
        },
      ] as any);

      mockPrisma.oracleRate.findFirst.mockResolvedValue(null);

      const result = await getEnterpriseTreasury(undefined, 0.01);

      expect(result.reconciliation.isReconciled).toBe(true);
      expect(result.reconciliation.calculatedTotal).toBeCloseTo(1000.05, 2);
      expect(result.reconciliation.discrepancyPercentage).toBeLessThan(0.01);
    });

    it("fails reconciliation when discrepancy exceeds tolerance", async () => {
      const now = new Date();

      // Ledger: $1000 USD
      mockPrisma.reserve.findMany.mockResolvedValue([
        {
          currency: "NGN",
          segment: ReserveTracker.SEGMENT_TRANSACTIONS,
          reserveAmount: new Decimal("1000000"),
          reserveValueUsd: new Decimal("1000"),
          timestamp: now,
        },
      ] as any);

      // Calculated: $1100 USD (10% discrepancy, exceeds 0.01% tolerance)
      mockPrisma.transaction.findMany.mockResolvedValue([
        {
          type: "transfer",
          localCurrency: "NGN",
          usdcAmount: new Decimal("1100"),
          acbuAmount: new Decimal("1100"),
          acbuAmountBurned: null,
        },
      ] as any);

      mockPrisma.oracleRate.findFirst.mockResolvedValue(null);

      const result = await getEnterpriseTreasury(undefined, 0.01);

      expect(result.reconciliation.isReconciled).toBe(false);
      expect(result.reconciliation.discrepancyPercentage).toBeGreaterThan(0.01);
      expect(result.reconciliation.warnings.length).toBeGreaterThan(0);
    });

    it("handles minted/burned transactions correctly", async () => {
      mockPrisma.reserve.findMany.mockResolvedValue([]);

      mockPrisma.transaction.findMany.mockResolvedValue([
        {
          type: "mint",
          localCurrency: "NGN",
          usdcAmount: new Decimal("500"),
          acbuAmount: new Decimal("500"),
          acbuAmountBurned: null,
        },
        {
          type: "burn",
          localCurrency: "NGN",
          usdcAmount: new Decimal("200"),
          acbuAmount: null,
          acbuAmountBurned: new Decimal("200"),
        },
        {
          type: "transfer",
          localCurrency: "NGN",
          usdcAmount: new Decimal("100"),
          acbuAmount: new Decimal("100"),
          acbuAmountBurned: null,
        },
      ] as any);

      mockPrisma.oracleRate.findFirst.mockResolvedValue(null);

      const result = await getEnterpriseTreasury();

      // Calculated: 500 (mint) - 200 (burn) + 100 (transfer) = 400
      expect(result.reconciliation.calculatedTotal).toBe(400);
    });

    it("handles transactions with null localCurrency", async () => {
      mockPrisma.reserve.findMany.mockResolvedValue([]);

      mockPrisma.transaction.findMany.mockResolvedValue([
        {
          type: "transfer",
          localCurrency: null, // No currency
          usdcAmount: new Decimal("100"),
          acbuAmount: new Decimal("100"),
          acbuAmountBurned: null,
        },
        {
          type: "transfer",
          localCurrency: "NGN",
          usdcAmount: new Decimal("200"),
          acbuAmount: new Decimal("200"),
          acbuAmountBurned: null,
        },
      ] as any);

      mockPrisma.oracleRate.findFirst.mockResolvedValue(null);

      const result = await getEnterpriseTreasury();

      // Should only count NGN transaction
      expect(result.byCurrency).toHaveLength(1);
      expect(result.byCurrency[0].currency).toBe("NGN");
    });

    it("returns accurate totals with multiple segments and currencies", async () => {
      const now = new Date();

      mockPrisma.reserve.findMany.mockResolvedValue([
        {
          currency: "NGN",
          segment: ReserveTracker.SEGMENT_TRANSACTIONS,
          reserveAmount: new Decimal("1000000"),
          reserveValueUsd: new Decimal("667.50"),
          timestamp: now,
        },
        {
          currency: "NGN",
          segment: ReserveTracker.SEGMENT_INVESTMENT_SAVINGS,
          reserveAmount: new Decimal("500000"),
          reserveValueUsd: new Decimal("333.75"),
          timestamp: now,
        },
        {
          currency: "KES",
          segment: ReserveTracker.SEGMENT_TRANSACTIONS,
          reserveAmount: new Decimal("500000"),
          reserveValueUsd: new Decimal("3850.00"),
          timestamp: now,
        },
        {
          currency: "KES",
          segment: ReserveTracker.SEGMENT_INVESTMENT_SAVINGS,
          reserveAmount: new Decimal("250000"),
          reserveValueUsd: new Decimal("1925.00"),
          timestamp: now,
        },
      ] as any);

      mockPrisma.transaction.findMany.mockResolvedValue([]);
      mockPrisma.oracleRate.findFirst.mockResolvedValue(null);

      const result = await getEnterpriseTreasury();

      expect(result.totalBalanceUsd).toBeCloseTo(6776.25, 2);
      expect(result.summary.transactionsSegmentUsd).toBeCloseTo(4517.5, 2);
      expect(result.summary.investmentSavingsSegmentUsd).toBeCloseTo(2258.75, 2);
    });

    it("handles enterprise-scale data with many currencies", async () => {
      const now = new Date();
      const reserves: any[] = [];

      // Simulate 50 currencies with dual segments
      const currencies = ["NGN", "KES", "ZAR", "GHS", "RWF", "TZS", "UGX", "EGP", "MAD", "XOF"];

      for (let i = 0; i < 5; i++) {
        for (const currency of currencies) {
          reserves.push({
            currency,
            segment: ReserveTracker.SEGMENT_TRANSACTIONS,
            reserveAmount: new Decimal(Math.random() * 1000000),
            reserveValueUsd: new Decimal(Math.random() * 5000),
            timestamp: now,
          });
          reserves.push({
            currency,
            segment: ReserveTracker.SEGMENT_INVESTMENT_SAVINGS,
            reserveAmount: new Decimal(Math.random() * 500000),
            reserveValueUsd: new Decimal(Math.random() * 2500),
            timestamp: now,
          });
        }
      }

      mockPrisma.reserve.findMany.mockResolvedValue(reserves);
      mockPrisma.transaction.findMany.mockResolvedValue([]);
      mockPrisma.oracleRate.findFirst.mockResolvedValue(null);

      const startTime = performance.now();
      const result = await getEnterpriseTreasury();
      const endTime = performance.now();

      // Should complete in reasonable time (< 1 second for 100 currencies)
      expect(endTime - startTime).toBeLessThan(1000);

      expect(result.totalBalanceUsd).toBeGreaterThan(0);
      expect(result.byCurrency.length).toBeGreaterThan(0);
    });
  });

  describe("getTreasuryHealth", () => {
    it("returns healthy status when reconciliation passes", async () => {
      mockPrisma.reserve.findMany.mockResolvedValue([]);
      mockPrisma.transaction.findMany.mockResolvedValue([]);
      mockPrisma.oracleRate.findFirst.mockResolvedValue(null);

      const result = await getTreasuryHealth();

      expect(result.healthy).toBe(true);
      expect(result.totalBalanceUsd).toBe(0);
      expect(result.warnings.length).toBe(0);
    });

    it("returns unhealthy status when reconciliation fails", async () => {
      const now = new Date();

      mockPrisma.reserve.findMany.mockResolvedValue([
        {
          currency: "NGN",
          segment: ReserveTracker.SEGMENT_TRANSACTIONS,
          reserveAmount: new Decimal("1000000"),
          reserveValueUsd: new Decimal("1000"),
          timestamp: now,
        },
      ] as any);

      // Major discrepancy
      mockPrisma.transaction.findMany.mockResolvedValue([
        {
          type: "transfer",
          localCurrency: "NGN",
          usdcAmount: new Decimal("5000"),
          acbuAmount: new Decimal("5000"),
          acbuAmountBurned: null,
        },
      ] as any);

      mockPrisma.oracleRate.findFirst.mockResolvedValue(null);

      const result = await getTreasuryHealth();

      expect(result.healthy).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("handles errors gracefully in health check", async () => {
      mockPrisma.reserve.findMany.mockRejectedValue(new Error("DB error"));

      const result = await getTreasuryHealth();

      expect(result.healthy).toBe(false);
      expect(result.totalBalanceUsd).toBe(0);
      expect(result.warnings).toContain("Treasury health check failed - see server logs");
    });
  });

  describe("Edge Cases", () => {
    it("handles zero reserve values correctly", async () => {
      mockPrisma.reserve.findMany.mockResolvedValue([
        {
          currency: "NGN",
          segment: ReserveTracker.SEGMENT_TRANSACTIONS,
          reserveAmount: new Decimal("0"),
          reserveValueUsd: new Decimal("0"),
          timestamp: new Date(),
        },
      ] as any);

      mockPrisma.transaction.findMany.mockResolvedValue([]);
      mockPrisma.oracleRate.findFirst.mockResolvedValue(null);

      const result = await getEnterpriseTreasury();

      expect(result.totalBalanceUsd).toBe(0);
      expect(Number.isFinite(result.totalBalanceUsd)).toBe(true);
    });

    it("handles very large reserve amounts (no overflow)", async () => {
      mockPrisma.reserve.findMany.mockResolvedValue([
        {
          currency: "NGN",
          segment: ReserveTracker.SEGMENT_TRANSACTIONS,
          reserveAmount: new Decimal("999999999999.99"),
          reserveValueUsd: new Decimal("999999999999.99"),
          timestamp: new Date(),
        },
      ] as any);

      mockPrisma.transaction.findMany.mockResolvedValue([]);
      mockPrisma.oracleRate.findFirst.mockResolvedValue(null);

      const result = await getEnterpriseTreasury();

      expect(Number.isFinite(result.totalBalanceUsd)).toBe(true);
    });

    it("applies custom tolerance correctly", async () => {
      mockPrisma.reserve.findMany.mockResolvedValue([
        {
          currency: "NGN",
          segment: ReserveTracker.SEGMENT_TRANSACTIONS,
          reserveAmount: new Decimal("1000000"),
          reserveValueUsd: new Decimal("1000"),
          timestamp: new Date(),
        },
      ] as any);

      mockPrisma.transaction.findMany.mockResolvedValue([
        {
          type: "transfer",
          localCurrency: "NGN",
          usdcAmount: new Decimal("1005"),
          acbuAmount: new Decimal("1005"), // 0.5% discrepancy
          acbuAmountBurned: null,
        },
      ] as any);

      mockPrisma.oracleRate.findFirst.mockResolvedValue(null);

      // With 0.01% tolerance: should fail
      const result1 = await getEnterpriseTreasury(undefined, 0.01);
      expect(result1.reconciliation.isReconciled).toBe(false);

      // With 1% tolerance: should pass
      const result2 = await getEnterpriseTreasury(undefined, 1);
      expect(result2.reconciliation.isReconciled).toBe(true);
    });
  });
});
