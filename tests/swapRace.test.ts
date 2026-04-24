process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
process.env.MONGODB_URI = "mongodb://localhost/test";
process.env.RABBITMQ_URL = "amqp://localhost";
process.env.JWT_SECRET = "test-secret";

jest.mock("../src/config/database", () => ({
  prisma: {
    onRampSwap: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("../src/controllers/mintController", () => ({
  mintFromUsdcInternal: jest.fn(),
}));

jest.mock("../src/services/stellar/usdcSwap", () => ({
  swapUsdcToXlm: jest.fn(),
}));

jest.mock("../src/services/oracle/cryptoClient", () => ({
  fetchXlmRateUsd: jest.fn().mockResolvedValue(0.2),
}));

jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logFinancialEvent: jest.fn(),
}));

import { prisma } from "../src/config/database";
import { processUsdcConvertAndMint } from "../src/jobs/usdcConvertAndMintJob";
import { processXlmToAcbu } from "../src/jobs/xlmToAcbuJob";

const mockUpdateMany = prisma.onRampSwap.updateMany as jest.Mock;
const mockFindUnique = prisma.onRampSwap.findUnique as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("B-075 — On-ramp swap race: duplicate processing", () => {
  describe("processUsdcConvertAndMint", () => {
    it("exits without processing when another worker already claimed the swap", async () => {
      mockUpdateMany.mockResolvedValue({ count: 0 });

      await processUsdcConvertAndMint({ onRampSwapId: "swap-001" });

      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "swap-001",
            status: "pending_convert",
          }),
          data: { status: "processing" },
        }),
      );
      expect(mockFindUnique).not.toHaveBeenCalled();
    });

    it("proceeds only when the atomic claim succeeds (count === 1)", async () => {
      const { swapUsdcToXlm } = jest.requireMock(
        "../src/services/stellar/usdcSwap",
      ) as { swapUsdcToXlm: jest.Mock };
      const { mintFromUsdcInternal } = jest.requireMock(
        "../src/controllers/mintController",
      ) as { mintFromUsdcInternal: jest.Mock };

      mockUpdateMany.mockResolvedValue({ count: 1 });
      mockFindUnique.mockResolvedValue({
        id: "swap-001",
        userId: "user-abc",
        stellarAddress: "GSTELLAR",
        usdcAmount: "100",
        source: "usdc_deposit",
        status: "processing",
      });
      swapUsdcToXlm.mockResolvedValue({ xlmReceived: 500, txHash: "txhash1" });
      mintFromUsdcInternal.mockResolvedValue({
        transactionId: "tx-001",
        acbuAmount: 95,
      });
      (prisma.onRampSwap.update as jest.Mock).mockResolvedValue({});

      await processUsdcConvertAndMint({ onRampSwapId: "swap-001" });

      expect(mockUpdateMany).toHaveBeenCalledTimes(1);
      expect(mockFindUnique).toHaveBeenCalledTimes(1);
      expect(mintFromUsdcInternal).toHaveBeenCalledWith(
        100,
        "GSTELLAR",
        "user-abc",
      );
    });
  });

  describe("processXlmToAcbu", () => {
    it("exits without processing when another worker already claimed the swap", async () => {
      mockUpdateMany.mockResolvedValue({ count: 0 });

      await processXlmToAcbu({
        onRampSwapId: "swap-002",
        userId: "user-xyz",
        stellarAddress: "GSTELLAR2",
        xlmAmount: "50",
      });

      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "swap-002",
            status: "pending_convert",
          }),
          data: { status: "processing" },
        }),
      );
      expect(mockFindUnique).not.toHaveBeenCalled();
    });

    it("proceeds only when the atomic claim succeeds (count === 1)", async () => {
      const { mintFromUsdcInternal } = jest.requireMock(
        "../src/controllers/mintController",
      ) as { mintFromUsdcInternal: jest.Mock };

      mockUpdateMany.mockResolvedValue({ count: 1 });
      mockFindUnique.mockResolvedValue({
        id: "swap-002",
        userId: "user-xyz",
        stellarAddress: "GSTELLAR2",
        status: "processing",
      });
      mintFromUsdcInternal.mockResolvedValue({
        transactionId: "tx-002",
        acbuAmount: 9,
      });
      (prisma.onRampSwap.update as jest.Mock).mockResolvedValue({});

      await processXlmToAcbu({
        onRampSwapId: "swap-002",
        userId: "user-xyz",
        stellarAddress: "GSTELLAR2",
        xlmAmount: "50",
        usdcEquivalent: "10",
      });

      expect(mockUpdateMany).toHaveBeenCalledTimes(1);
      expect(mockFindUnique).toHaveBeenCalledTimes(1);
      expect(mintFromUsdcInternal).toHaveBeenCalledWith(
        10,
        "GSTELLAR2",
        "user-xyz",
      );
    });
  });
});
