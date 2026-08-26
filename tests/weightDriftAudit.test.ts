/**
 * Weight Drift Audit Service Tests
 *
 * Test scenarios:
 * 1. calculateDriftReport: drift math, threshold edge cases, recommendations,
 *    and failure propagation when basket/reserve lookups fail
 * 2. createAudit: pending audit + per-currency rows + audit log, with failure paths
 * 3. approveAudit / rejectAudit: happy path, non-pending guards, not-found
 * 4. listAudits: pagination + status filtering
 * 5. getAudit: full detail + not-found
 */

import { weightDriftAuditService } from "../src/services/reserve/WeightDriftAuditService";
import { basketService } from "../src/services/basket";
import { reserveTracker } from "../src/services/reserve/ReserveTracker";
import { auditService } from "../src/services/audit";
import { prisma } from "../src/config/database";

jest.mock("../src/services/basket");
jest.mock("../src/services/reserve/ReserveTracker");
jest.mock("../src/services/audit");

jest.mock("../src/config/database", () => {
  type MockModel = { [method: string]: jest.Mock };
  function createMockModel(): MockModel {
    return new Proxy({} as MockModel, {
      get: (t, p) => {
        if (typeof p === "string") {
          if (!(p in t)) t[p] = jest.fn();
          return t[p];
        }
        return undefined;
      },
    });
  }
  const prismaModels: Record<string, MockModel> = {};
  const mockPrisma = new Proxy(
    {
      $transaction: jest.fn(),
      $connect: jest.fn().mockResolvedValue(undefined),
      $disconnect: jest.fn().mockResolvedValue(undefined),
      $use: jest.fn(),
      $on: jest.fn(),
      $extends: jest.fn().mockReturnThis(),
    } as any,
    {
      get: (t, p) => {
        if (p in t) return t[p];
        if (typeof p === "string" && !p.startsWith("$")) {
          if (!(p in prismaModels)) prismaModels[p] = createMockModel();
          return prismaModels[p];
        }
        return undefined;
      },
    },
  );
  return {
    prisma: mockPrisma,
    prismaReplica: mockPrisma,
    connectWithRetry: jest.fn().mockResolvedValue(undefined),
    default: mockPrisma,
  };
});

describe("WeightDriftAuditService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: ReturnType<typeof makeMockTx>) => unknown) => fn(makeMockTx()),
    );
  });

  describe("calculateDriftReport", () => {
    it("calculates drift per currency and flags entries above the 2% threshold", async () => {
      (basketService.getCurrentBasket as jest.Mock).mockResolvedValue([
        { currency: "USD", weight: 40 },
        { currency: "NGN", weight: 30 },
        { currency: "KES", weight: 30 },
      ]);

      (reserveTracker.getReserveStatus as jest.Mock).mockResolvedValue({
        currencies: [
          { currency: "USD", actualWeight: 43 },
          { currency: "NGN", actualWeight: 27 },
          { currency: "KES", actualWeight: 30 },
        ],
      });

      const report = await weightDriftAuditService.calculateDriftReport();

      expect(report.totalCurrencies).toBe(3);
      expect(report.currenciesExceedingThreshold).toBe(2); // USD +3, NGN -3
      expect(report.maxDriftPercent).toBe(3);
      expect(report.status).toBe("pending");
      expect(report.auditId).toBe("");

      const usdEntry = report.entries.find((e) => e.currency === "USD");
      expect(usdEntry?.driftPercent).toBe(3);
      expect(usdEntry?.exceedsThreshold).toBe(true);

      const ngnEntry = report.entries.find((e) => e.currency === "NGN");
      expect(ngnEntry?.driftPercent).toBe(-3);
      expect(ngnEntry?.exceedsThreshold).toBe(true);

      const kesEntry = report.entries.find((e) => e.currency === "KES");
      expect(kesEntry?.driftPercent).toBe(0);
      expect(kesEntry?.exceedsThreshold).toBe(false);
    });

    it("treats a currency missing from reserves as actual weight 0", async () => {
      (basketService.getCurrentBasket as jest.Mock).mockResolvedValue([
        { currency: "USD", weight: 50 },
        { currency: "EUR", weight: 50 },
      ]);

      (reserveTracker.getReserveStatus as jest.Mock).mockResolvedValue({
        currencies: [{ currency: "USD", actualWeight: 60 }],
      });

      const report = await weightDriftAuditService.calculateDriftReport();

      const eurEntry = report.entries.find((e) => e.currency === "EUR");
      expect(eurEntry?.actualWeight).toBe(0);
      expect(eurEntry?.driftPercent).toBe(-50);
      expect(eurEntry?.exceedsThreshold).toBe(true);
    });

    it("does not flag a drift of exactly 2% (threshold is strictly greater than)", async () => {
      (basketService.getCurrentBasket as jest.Mock).mockResolvedValue([
        { currency: "USD", weight: 40 },
      ]);

      (reserveTracker.getReserveStatus as jest.Mock).mockResolvedValue({
        currencies: [{ currency: "USD", actualWeight: 42 }], // drift exactly 2
      });

      const report = await weightDriftAuditService.calculateDriftReport();

      expect(report.entries[0].driftPercent).toBe(2);
      expect(report.entries[0].exceedsThreshold).toBe(false);
      expect(report.currenciesExceedingThreshold).toBe(0);
    });

    it("flags a drift just above 2%", async () => {
      (basketService.getCurrentBasket as jest.Mock).mockResolvedValue([
        { currency: "USD", weight: 40 },
      ]);

      (reserveTracker.getReserveStatus as jest.Mock).mockResolvedValue({
        currencies: [{ currency: "USD", actualWeight: 42.01 }],
      });

      const report = await weightDriftAuditService.calculateDriftReport();

      expect(report.entries[0].driftPercent).toBeCloseTo(2.01, 5);
      expect(report.entries[0].exceedsThreshold).toBe(true);
      expect(report.currenciesExceedingThreshold).toBe(1);
    });

    it("generates overweight / underweight / within-range recommendations", async () => {
      (basketService.getCurrentBasket as jest.Mock).mockResolvedValue([
        { currency: "USD", weight: 50 },
        { currency: "NGN", weight: 30 },
        { currency: "KES", weight: 20 },
      ]);

      (reserveTracker.getReserveStatus as jest.Mock).mockResolvedValue({
        currencies: [
          { currency: "USD", actualWeight: 55 }, // +5 overweight
          { currency: "NGN", actualWeight: 25 }, // -5 underweight
          { currency: "KES", actualWeight: 20.1 }, // +0.1 within range
        ],
      });

      const report = await weightDriftAuditService.calculateDriftReport();

      const usdEntry = report.entries.find((e) => e.currency === "USD")!;
      expect(usdEntry.recommendation).toContain("Overweight");
      expect(usdEntry.recommendation).toContain("USD");
      expect(usdEntry.recommendation).toContain("50%");

      const ngnEntry = report.entries.find((e) => e.currency === "NGN")!;
      expect(ngnEntry.recommendation).toContain("Underweight");
      expect(ngnEntry.recommendation).toContain("NGN");
      expect(ngnEntry.recommendation).toContain("30%");

      const kesEntry = report.entries.find((e) => e.currency === "KES")!;
      expect(kesEntry.recommendation).toBe("Within acceptable range. No action required.");
    });

  describe("createAudit", () => {
    it("should create audit record with pending status", async () => {
      const report = {
        auditId: "",
        auditPeriodStart: new Date("2026-04-20"),
        auditPeriodEnd: new Date("2026-04-27"),
        totalCurrencies: 3,
        currenciesExceedingThreshold: 1,
        maxDriftPercent: 2.5,
        entries: [
          {
            currency: "USD",
            policyWeight: 40,
            actualWeight: 42.5,
            driftPercent: 2.5,
            exceedsThreshold: true,
            recommendation: "Overweight by 2.50%",
          },
        ],
        status: "pending" as const,
      };

      // Mock prisma transaction
      (prisma.$transaction as any).mockImplementation(async (fn: (tx: any) => Promise<any>) => {
        const mockTx = {
          weightDriftAudit: {
            create: jest.fn().mockResolvedValue({
              id: "audit-123",
              ...report,
              createdBy: "admin-1",
              status: "pending",
            }),
          },
          weightDriftCurrency: {
            create: jest.fn().mockResolvedValue({}),
          },
        };
        return fn(mockTx);
      });

      const report = await weightDriftAuditService.calculateDriftReport();

      expect(report.auditPeriodEnd.getTime()).toBeGreaterThanOrEqual(before);
      // ~7 days between start and end
      const days = Math.round(
        (report.auditPeriodEnd.getTime() - report.auditPeriodStart.getTime()) /
          (24 * 60 * 60 * 1000),
      );
      expect(days).toBe(7);
    });

    it("logs and rethrows when the basket lookup fails", async () => {
      const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => logger);
      (basketService.getCurrentBasket as jest.Mock).mockRejectedValue(
        new Error("basket service down"),
      );

      await expect(weightDriftAuditService.calculateDriftReport()).rejects.toThrow(
        "basket service down",
      );

      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to calculate weight drift report",
        expect.objectContaining({ error: expect.any(Error) }),
      );
      errorSpy.mockRestore();
    });
  });

  describe("createAudit", () => {
    it("creates the audit record and per-currency rows, then returns the report with id", async () => {
      const report = makeReport();
      mockAuditCreate.mockResolvedValue(makeAuditRow());
      (logAudit as jest.Mock).mockResolvedValue(undefined);

      const result = await weightDriftAuditService.createAudit(report, "admin-1");

      expect(result.auditId).toBe("audit-123");
      expect(result.status).toBe("pending");

      // Main record created with pending status + diff report
      expect(mockAuditCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          auditPeriodStart: report.auditPeriodStart,
          auditPeriodEnd: report.auditPeriodEnd,
          totalCurrencies: 2,
          currenciesExceedingThreshold: 1,
          maxDriftPercent: expect.any(Decimal),
          status: "pending",
          diffReport: report,
          createdBy: "admin-1",
        }),
      });

      // One row per currency entry
      expect(mockCurrencyCreate).toHaveBeenCalledTimes(2);
      expect(mockCurrencyCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          auditId: "audit-123",
          currency: "USD",
          policyWeight: expect.any(Decimal),
          actualWeight: expect.any(Decimal),
          driftPercent: expect.any(Decimal),
          exceedsThreshold: true,
          recommendation: expect.any(String),
        }),
      });

      // Audit trail entry emitted
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "WEIGHT_DRIFT_AUDIT_CREATED",
          entityType: "WeightDriftAudit",
          entityId: "audit-123",
          action: "create",
          performedBy: "admin-1",
          newValue: expect.objectContaining({ status: "pending" }),
        }),
      );
    });

    it("propagates the error when the audit record insert fails", async () => {
      mockAuditCreate.mockRejectedValue(new Error("db unavailable"));

      await expect(weightDriftAuditService.createAudit(makeReport(), "admin-1")).rejects.toThrow(
        "db unavailable",
      );

      // No per-currency rows or audit entries after the failed insert
      expect(mockCurrencyCreate).not.toHaveBeenCalled();
      expect(logAudit).not.toHaveBeenCalled();
    });

    it("propagates the error when a per-currency insert fails", async () => {
      mockAuditCreate.mockResolvedValue(makeAuditRow());
      mockCurrencyCreate.mockRejectedValueOnce(new Error("row insert failed"));

      await expect(weightDriftAuditService.createAudit(makeReport(), "admin-1")).rejects.toThrow(
        "row insert failed",
      );

      expect(logAudit).not.toHaveBeenCalled();
    });

    it("propagates the error when the audit trail write fails", async () => {
      mockAuditCreate.mockResolvedValue(makeAuditRow());
      (logAudit as jest.Mock).mockRejectedValue(new Error("audit log down"));

      await expect(weightDriftAuditService.createAudit(makeReport(), "admin-1")).rejects.toThrow(
        "audit log down",
      );
    });
  });

  describe("approveAudit", () => {
    it("approves a pending audit and logs the approval", async () => {
      mockPrisma.weightDriftAudit.findUniqueOrThrow.mockResolvedValue(
        makeAuditRow({ status: "pending", currencies: [makeCurrencyRow()] }),
      );
      mockAuditUpdate.mockResolvedValue(
        makeAuditRow({
          status: "approved",
          approvedBy: "admin-1",
          approvalNotes: "Drift within expected range",
          approvedAt: new Date("2026-04-28T00:00:00Z"),
        }),
      );
      (logAudit as jest.Mock).mockResolvedValue(undefined);

      const result = await weightDriftAuditService.approveAudit(
        "audit-123",
        "admin-1",
        "Drift within expected range",
      );

      expect(result.status).toBe("approved");
      expect(result.auditId).toBe("audit-123");
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].currency).toBe("USD");
      expect(result.entries[0].driftPercent).toBe(2.5);

      expect(mockAuditUpdate).toHaveBeenCalledWith({
        where: { id: "audit-123" },
        data: expect.objectContaining({
          status: "approved",
          approvedBy: "admin-1",
          approvalNotes: "Drift within expected range",
          approvedAt: expect.any(Date),
        }),
      });

      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "WEIGHT_DRIFT_AUDIT_APPROVED",
          action: "approve",
          performedBy: "admin-1",
          newValue: expect.objectContaining({ status: "approved" }),
        }),
      );
    });

    it("rejects approving an audit that is not pending", async () => {
      mockPrisma.weightDriftAudit.findUniqueOrThrow.mockResolvedValue(
        makeAuditRow({ status: "approved", currencies: [] }),
      );

      ((prisma as any).weightDriftAudit.findUniqueOrThrow as jest.Mock).mockResolvedValue(
        mockAudit,
      );

      expect(mockAuditUpdate).not.toHaveBeenCalled();
      expect(logAudit).not.toHaveBeenCalled();
    });

    it("propagates not-found (P2025) from findUniqueOrThrow", async () => {
      const notFound = Object.assign(new Error("Record not found"), { code: "P2025" });
      mockPrisma.weightDriftAudit.findUniqueOrThrow.mockRejectedValue(notFound);

      await expect(
        weightDriftAuditService.approveAudit("missing", "admin-1"),
      ).rejects.toMatchObject({ code: "P2025" });
    });
  });

  describe("rejectAudit", () => {
    it("rejects a pending audit with a reason and logs the rejection", async () => {
      mockPrisma.weightDriftAudit.findUniqueOrThrow.mockResolvedValue(
        makeAuditRow({ status: "pending", currencies: [makeCurrencyRow()] }),
      );

      (prisma.$transaction as any).mockImplementation(async (fn: (tx: any) => Promise<any>) => {
        const mockTx = {
          weightDriftAudit: {
            update: jest.fn().mockResolvedValue({
              ...mockAudit,
              status: "rejected",
              approvalNotes: "Market volatility expected",
            }),
          },
        };
        return fn(mockTx);
      });

      (auditService.logAuditEntry as jest.Mock).mockResolvedValue(undefined);

      const result = await weightDriftAuditService.rejectAudit(
        "audit-123",
        "admin-1",
        "Market volatility expected",
      );

      expect(result.status).toBe("rejected");

      expect(mockAuditUpdate).toHaveBeenCalledWith({
        where: { id: "audit-123" },
        data: expect.objectContaining({
          status: "rejected",
          approvalNotes: "Market volatility expected",
        }),
      });

      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "WEIGHT_DRIFT_AUDIT_REJECTED",
          action: "reject",
          performedBy: "admin-1",
          newValue: expect.objectContaining({
            status: "rejected",
            reason: "Market volatility expected",
          }),
        }),
      );
    });

    it("rejects rejecting an audit that is not pending", async () => {
      mockPrisma.weightDriftAudit.findUniqueOrThrow.mockResolvedValue(
        makeAuditRow({ status: "rejected", currencies: [] }),
      );

      await expect(
        weightDriftAuditService.rejectAudit("audit-123", "admin-1", "nope"),
      ).rejects.toThrow("Cannot reject audit with status: rejected");

      expect(mockAuditUpdate).not.toHaveBeenCalled();
    });
  });

  describe("listAudits", () => {
    it("lists audits with pagination and converts stored decimals", async () => {
      mockPrisma.weightDriftAudit.findMany.mockResolvedValue([
        makeAuditRow({
          status: "approved",
          currencies: [makeCurrencyRow()],
        }),
      ]);
      mockPrisma.weightDriftAudit.count.mockResolvedValue(1);

      const result = await weightDriftAuditService.listAudits(undefined, 20, 0);

      expect(result.total).toBe(1);
      expect(result.audits).toHaveLength(1);
      expect(result.audits[0].status).toBe("approved");
      expect(result.audits[0].maxDriftPercent).toBe(2.5);

      expect(mockPrisma.weightDriftAudit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          take: 20,
          skip: 0,
          orderBy: { createdAt: "desc" },
        }),
      );
    });

    it("filters by status when provided", async () => {
      mockPrisma.weightDriftAudit.findMany.mockResolvedValue([]);
      mockPrisma.weightDriftAudit.count.mockResolvedValue(0);

      await weightDriftAuditService.listAudits("pending", 10, 5);

      expect(mockPrisma.weightDriftAudit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: "pending" },
          take: 10,
          skip: 5,
        }),
      );
    });
  });

  describe("getAudit", () => {
    it("returns the formatted audit with per-currency entries", async () => {
      mockPrisma.weightDriftAudit.findUniqueOrThrow.mockResolvedValue(
        makeAuditRow({
          status: "approved",
          currencies: [
            makeCurrencyRow(),
            makeCurrencyRow({
              id: "cur-2",
              currency: "NGN",
              policyWeight: new Decimal("30.00"),
              actualWeight: new Decimal("27.00"),
              driftPercent: new Decimal("-3.0000"),
              exceedsThreshold: true,
              recommendation: null,
            }),
          ],
        }),
      );

      const result = await weightDriftAuditService.getAudit("audit-123");

      expect(result.auditId).toBe("audit-123");
      expect(result.entries).toHaveLength(2);
      const ngn = result.entries.find((e) => e.currency === "NGN")!;
      expect(ngn.driftPercent).toBe(-3);
      expect(ngn.recommendation).toBe(""); // null recommendation → empty string
    });

    it("propagates not-found (P2025) from findUniqueOrThrow", async () => {
      const notFound = Object.assign(new Error("Record not found"), { code: "P2025" });
      mockPrisma.weightDriftAudit.findUniqueOrThrow.mockRejectedValue(notFound);

      await expect(weightDriftAuditService.getAudit("missing")).rejects.toMatchObject({
        code: "P2025",
      });
    });
  });
});
