import {
  getMonthlyStatements,
  getAuditExports,
  getTransactionsForTreasuryReport,
  getLatestReserves,
} from "../../../src/services/reports/reportService";
import { prismaReplica } from "../../../src/config/database";

jest.mock("../../../src/config/database", () => ({
  prisma: {
    $disconnect: jest.fn().mockResolvedValue(undefined),
  },
  prismaReplica: {
    transaction: {
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    reserve: {
      findMany: jest.fn(),
    },
  },
}));

describe("Report Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getMonthlyStatements", () => {
    it("should call findMany on transaction and return results", async () => {
      const mockResult = [{ id: "tx-1", type: "mint" }];
      (prismaReplica.transaction.findMany as jest.Mock).mockResolvedValue(mockResult);

      const where = { userId: "user-123" };
      const result = await getMonthlyStatements(where, 10);

      expect(prismaReplica.transaction.findMany).toHaveBeenCalledWith({
        where,
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          type: true,
          status: true,
          acbuAmount: true,
          acbuAmountBurned: true,
          usdcAmount: true,
          localCurrency: true,
          localAmount: true,
          fee: true,
          createdAt: true,
        },
      });
      expect(result).toEqual(mockResult);
    });
  });

  describe("getAuditExports", () => {
    it("should call findUnique on user with correct include structure", async () => {
      const mockUser = { id: "user-123", email: "user@example.com" };
      (prismaReplica.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      const result = await getAuditExports("user-123");

      expect(prismaReplica.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-123" },
        include: {
          apiKeys: true,
          guardians: true,
          wardGuardians: true,
          kycApplications: true,
          kycValidators: true,
          onRampSwaps: true,
          otpChallenges: true,
          transactions: true,
          contacts: true,
          contactOf: true,
          passkeys: true,
          salaryBatches: true,
          salarySchedules: true,
        },
      });
      expect(result).toEqual(mockUser);
    });
  });

  describe("getTransactionsForTreasuryReport", () => {
    it("should call findMany on transaction and return treasury transaction list", async () => {
      const mockResult = [{ type: "mint", localCurrency: "USD" }];
      (prismaReplica.transaction.findMany as jest.Mock).mockResolvedValue(mockResult);

      const result = await getTransactionsForTreasuryReport();

      expect(prismaReplica.transaction.findMany).toHaveBeenCalledWith({
        where: {
          status: { in: ["completed", "processing"] },
          type: { in: ["mint", "burn", "transfer"] },
        },
        select: {
          type: true,
          localCurrency: true,
          acbuAmount: true,
          acbuAmountBurned: true,
        },
      });
      expect(result).toEqual(mockResult);
    });
  });

  describe("getLatestReserves", () => {
    it("should call findMany on reserve and return distinct latest reserves", async () => {
      const mockResult = [{ currency: "USD", segment: "transactions" }];
      (prismaReplica.reserve.findMany as jest.Mock).mockResolvedValue(mockResult);

      const result = await getLatestReserves();

      expect(prismaReplica.reserve.findMany).toHaveBeenCalledWith({
        orderBy: { timestamp: "desc" },
        distinct: ["currency", "segment"],
        select: {
          currency: true,
          segment: true,
          reserveAmount: true,
          reserveValueUsd: true,
          timestamp: true,
        },
      });
      expect(result).toEqual(mockResult);
    });
  });
});
