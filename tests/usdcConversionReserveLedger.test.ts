/**
 * AB-030 — the reserve ledger must only move for conversions that happened.
 *
 * `processUsdcConversion` allocates the credited USDC across the current basket
 * and records one `reserveHistory` row per currency. The FX call for each
 * currency is guarded individually, so a failing provider must leave that
 * currency out of the ledger rather than crediting reserves twice over.
 */

process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
process.env.MONGODB_URI = "mongodb://localhost/test";
process.env.RABBITMQ_URL = "amqp://localhost";
process.env.JWT_SECRET = "test-secret-min-32-characters-long";

jest.mock("../src/config/database", () => ({
  prisma: {
    reserveHistory: { create: jest.fn() },
    transaction: { update: jest.fn() },
  },
}));

jest.mock("../src/services/basket", () => ({
  basketService: { getCurrentBasket: jest.fn() },
}));

jest.mock("../src/services/fintech", () => ({
  getFintechRouter: jest.fn(),
}));

jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logFinancialEvent: jest.fn(),
}));

import { prisma } from "../src/config/database";
import { basketService } from "../src/services/basket";
import { getFintechRouter } from "../src/services/fintech";
import { processUsdcConversion } from "../src/jobs/usdcConversionJob";

const mockReserveCreate = prisma.reserveHistory.create as jest.Mock;
const mockTransactionUpdate = prisma.transaction.update as jest.Mock;
const mockGetCurrentBasket = basketService.getCurrentBasket as jest.Mock;
const mockGetFintechRouter = getFintechRouter as jest.Mock;

const convertCurrency = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCurrentBasket.mockResolvedValue([
    { currency: "NGN", weight: 50 },
    { currency: "KES", weight: 30 },
    { currency: "GHS", weight: 20 },
  ]);
  mockGetFintechRouter.mockReturnValue({
    getProvider: jest.fn().mockResolvedValue({ convertCurrency }),
  });
  convertCurrency.mockResolvedValue({ ok: true });
  mockReserveCreate.mockResolvedValue({});
  mockTransactionUpdate.mockResolvedValue({});
});

describe("processUsdcConversion reserve accounting (AB-030)", () => {
  it("records one reserve entry per basket currency when every conversion succeeds", async () => {
    await processUsdcConversion({
      usdcAmount: "200",
      recipient: "GUSER",
      txHash: "hash-1",
      transactionId: "tx-1",
    });

    expect(mockReserveCreate).toHaveBeenCalledTimes(3);
    expect(mockReserveCreate.mock.calls.map((c) => c[0].data.currency)).toEqual([
      "NGN",
      "KES",
      "GHS",
    ]);
    expect(mockReserveCreate.mock.calls[0][0].data).toMatchObject({
      currency: "NGN",
      reason: "conversion",
      newAmount: null,
    });
    expect(Number(mockReserveCreate.mock.calls[0][0].data.amountChange)).toBe(100);
    expect(mockTransactionUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not credit reserves for a currency whose conversion failed", async () => {
    convertCurrency.mockImplementation(async (_amount: number, _from: string, to: string) => {
      if (to === "KES") throw new Error("provider timeout");
      return { ok: true };
    });

    await processUsdcConversion({
      usdcAmount: "200",
      recipient: "GUSER",
      txHash: "hash-2",
      transactionId: "tx-2",
    });

    const credited = mockReserveCreate.mock.calls.map((c) => c[0].data.currency);
    expect(credited).toEqual(["NGN", "GHS"]);
    expect(credited).not.toContain("KES");
  });

  it("records nothing at all when every conversion fails", async () => {
    convertCurrency.mockRejectedValue(new Error("provider down"));

    await processUsdcConversion({
      usdcAmount: "200",
      recipient: "GUSER",
      txHash: "hash-3",
      transactionId: "tx-3",
    });

    expect(mockReserveCreate).not.toHaveBeenCalled();
  });

  it("skips the whole allocation for a non-positive amount", async () => {
    await processUsdcConversion({ usdcAmount: "0", recipient: "GUSER", txHash: "hash-4" });

    expect(mockGetCurrentBasket).not.toHaveBeenCalled();
    expect(mockReserveCreate).not.toHaveBeenCalled();
  });
});
