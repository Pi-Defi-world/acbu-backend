import {
  checkDepositLimits,
  checkWithdrawalLimits,
  isCurrencyWithdrawalPaused,
  isMintingPaused,
} from "./limitsService";
import { prisma } from "../../config/database";

jest.mock("../../config/database", () => ({
  prisma: {
    transaction: { aggregate: jest.fn() },
  },
}));

jest.mock("../../config/limits", () => ({
  getLimitConfig: jest.fn().mockReturnValue({
    depositDailyUsd: 5000,
    depositMonthlyUsd: 50000,
    withdrawalSingleCurrencyDailyUsd: 10000,
    withdrawalSingleCurrencyMonthlyUsd: 80000,
  }),
  CIRCUIT_BREAKER_RESERVE_WEIGHT_THRESHOLD_PCT: 10,
  CIRCUIT_BREAKER_MIN_RESERVE_RATIO: 1.02,
}));

jest.mock("../reserve/ReserveTracker", () => ({
  reserveTracker: {
    getReserveStatus: jest.fn(),
    calculateReserveRatio: jest.fn(),
  },
  ReserveTracker: {
    SEGMENT_TRANSACTIONS: "transactions",
  },
}));

jest.mock("../../config/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { reserveTracker } from "../reserve/ReserveTracker";

describe("limitsService", () => {
  beforeEach(() => jest.clearAllMocks());

  // ── checkDepositLimits ─────────────────────────────────────────────────────

  describe("checkDepositLimits", () => {
    it("resolves without error when amount is within daily and monthly caps", async () => {
      (prisma.transaction.aggregate as jest.Mock)
        .mockResolvedValueOnce({
          _sum: { usdcAmount: { toNumber: () => 100 } },
        }) // daily
        .mockResolvedValueOnce({
          _sum: { usdcAmount: { toNumber: () => 500 } },
        }); // monthly
      await expect(
        checkDepositLimits("retail", 100, "u1", null),
      ).resolves.toBeUndefined();
    });

    it("throws AppError 429 when daily deposit limit is exceeded", async () => {
      (prisma.transaction.aggregate as jest.Mock)
        .mockResolvedValueOnce({
          _sum: { usdcAmount: { toNumber: () => 4950 } },
        })
        .mockResolvedValueOnce({
          _sum: { usdcAmount: { toNumber: () => 1000 } },
        });
      await expect(
        checkDepositLimits("retail", 100, "u1", null),
      ).rejects.toMatchObject({
        statusCode: 429,
        message: expect.stringContaining("daily limit"),
      });
    });

    it("throws AppError 429 when monthly deposit limit is exceeded", async () => {
      (prisma.transaction.aggregate as jest.Mock)
        .mockResolvedValueOnce({ _sum: { usdcAmount: { toNumber: () => 0 } } })
        .mockResolvedValueOnce({
          _sum: { usdcAmount: { toNumber: () => 49950 } },
        });
      await expect(
        checkDepositLimits("retail", 100, "u1", null),
      ).rejects.toMatchObject({
        statusCode: 429,
        message: expect.stringContaining("monthly limit"),
      });
    });

    it("handles null aggregate sums (no prior transactions) without throwing", async () => {
      (prisma.transaction.aggregate as jest.Mock)
        .mockResolvedValueOnce({ _sum: { usdcAmount: null } })
        .mockResolvedValueOnce({ _sum: { usdcAmount: null } });
      await expect(
        checkDepositLimits("retail", 50, "u1", null),
      ).resolves.toBeUndefined();
    });

    it("uses organizationId actor when userId is null", async () => {
      (prisma.transaction.aggregate as jest.Mock)
        .mockResolvedValueOnce({ _sum: { usdcAmount: null } })
        .mockResolvedValueOnce({ _sum: { usdcAmount: null } });
      await checkDepositLimits("business", 1000, null, "org-1");
      const call = (prisma.transaction.aggregate as jest.Mock).mock.calls[0][0];
      expect(call.where).toHaveProperty("OR");
    });
  });

  // ── checkWithdrawalLimits ──────────────────────────────────────────────────

  describe("checkWithdrawalLimits", () => {
    it("resolves without error when amount is within limits", async () => {
      (prisma.transaction.aggregate as jest.Mock)
        .mockResolvedValueOnce({
          _sum: { acbuAmountBurned: { toNumber: () => 0 } },
        })
        .mockResolvedValueOnce({
          _sum: { acbuAmountBurned: { toNumber: () => 0 } },
        });
      await expect(
        checkWithdrawalLimits("retail", 100, "NGN", "u1", null),
      ).resolves.toBeUndefined();
    });

    it("throws AppError 429 when daily withdrawal limit is exceeded", async () => {
      (prisma.transaction.aggregate as jest.Mock)
        .mockResolvedValueOnce({
          _sum: { acbuAmountBurned: { toNumber: () => 9950 } },
        })
        .mockResolvedValueOnce({
          _sum: { acbuAmountBurned: { toNumber: () => 0 } },
        });
      await expect(
        checkWithdrawalLimits("retail", 100, "NGN", "u1", null),
      ).rejects.toMatchObject({
        statusCode: 429,
        message: expect.stringContaining("daily limit"),
      });
    });

    it("throws AppError 429 when monthly withdrawal limit is exceeded", async () => {
      (prisma.transaction.aggregate as jest.Mock)
        .mockResolvedValueOnce({
          _sum: { acbuAmountBurned: { toNumber: () => 0 } },
        })
        .mockResolvedValueOnce({
          _sum: { acbuAmountBurned: { toNumber: () => 79950 } },
        });
      await expect(
        checkWithdrawalLimits("retail", 100, "NGN", "u1", null),
      ).rejects.toMatchObject({
        statusCode: 429,
        message: expect.stringContaining("monthly limit"),
      });
    });

    it("handles null aggregate sums (no prior burns) without throwing", async () => {
      (prisma.transaction.aggregate as jest.Mock)
        .mockResolvedValueOnce({ _sum: { acbuAmountBurned: null } })
        .mockResolvedValueOnce({ _sum: { acbuAmountBurned: null } });
      await expect(
        checkWithdrawalLimits("retail", 50, "NGN", "u1", null),
      ).resolves.toBeUndefined();
    });

    it("scopes query to the specific currency", async () => {
      (prisma.transaction.aggregate as jest.Mock).mockResolvedValue({
        _sum: { acbuAmountBurned: null },
      });
      await checkWithdrawalLimits("retail", 10, "KES", "u1", null);
      const call = (prisma.transaction.aggregate as jest.Mock).mock.calls[0][0];
      expect(call.where).toMatchObject({ localCurrency: "KES" });
    });
  });

  // ── isCurrencyWithdrawalPaused ─────────────────────────────────────────────

  describe("isCurrencyWithdrawalPaused", () => {
    it("returns false when currency is not present in reserve status", async () => {
      (reserveTracker.getReserveStatus as jest.Mock).mockResolvedValue({
        currencies: [],
      });
      expect(await isCurrencyWithdrawalPaused("XYZ")).toBe(false);
    });

    it("returns true when actual reserve weight is below threshold (5% < 10%)", async () => {
      (reserveTracker.getReserveStatus as jest.Mock).mockResolvedValue({
        currencies: [{ currency: "NGN", targetWeight: 100, actualWeight: 5 }],
      });
      expect(await isCurrencyWithdrawalPaused("NGN")).toBe(true);
    });

    it("returns false when actual reserve weight is above threshold (50% > 10%)", async () => {
      (reserveTracker.getReserveStatus as jest.Mock).mockResolvedValue({
        currencies: [{ currency: "NGN", targetWeight: 100, actualWeight: 50 }],
      });
      expect(await isCurrencyWithdrawalPaused("NGN")).toBe(false);
    });

    it("returns false when targetWeight is zero (avoids divide-by-zero)", async () => {
      (reserveTracker.getReserveStatus as jest.Mock).mockResolvedValue({
        currencies: [{ currency: "NGN", targetWeight: 0, actualWeight: 0 }],
      });
      expect(await isCurrencyWithdrawalPaused("NGN")).toBe(false);
    });
  });

  // ── isMintingPaused ────────────────────────────────────────────────────────

  describe("isMintingPaused", () => {
    it("returns true when reserve ratio is below minimum (1.01 < 1.02)", async () => {
      (reserveTracker.calculateReserveRatio as jest.Mock).mockResolvedValue(
        1.01,
      );
      expect(await isMintingPaused()).toBe(true);
    });

    it("returns false when reserve ratio is exactly at minimum (1.02)", async () => {
      (reserveTracker.calculateReserveRatio as jest.Mock).mockResolvedValue(
        1.02,
      );
      expect(await isMintingPaused()).toBe(false);
    });

    it("returns false when reserve ratio is comfortably above minimum (1.05)", async () => {
      (reserveTracker.calculateReserveRatio as jest.Mock).mockResolvedValue(
        1.05,
      );
      expect(await isMintingPaused()).toBe(false);
    });
  });
});
