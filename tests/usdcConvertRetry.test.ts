/**
 * AB-019 — a failed USDC→ACBU conversion has to stay retryable.
 *
 * The consumer only redelivers a message that was not acked, and
 * `processUsdcConvertAndMint` only picks a swap up while its status is
 * `pending_convert`. Parking the swap in `failed` before rethrowing therefore
 * made every redelivery a no-op and left the deposit stuck.
 */

process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
process.env.MONGODB_URI = "mongodb://localhost/test";
process.env.RABBITMQ_URL = "amqp://localhost";
process.env.JWT_SECRET = "test-secret-min-32-characters-long";

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

jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logFinancialEvent: jest.fn(),
}));

import { prisma } from "../src/config/database";
import { mintFromUsdcInternal } from "../src/controllers/mintController";
import { swapUsdcToXlm } from "../src/services/stellar/usdcSwap";
import { processUsdcConvertAndMint } from "../src/jobs/usdcConvertAndMintJob";

const mockUpdateMany = prisma.onRampSwap.updateMany as jest.Mock;
const mockFindUnique = prisma.onRampSwap.findUnique as jest.Mock;
const mockUpdate = prisma.onRampSwap.update as jest.Mock;
const mockSwap = swapUsdcToXlm as jest.Mock;
const mockMint = mintFromUsdcInternal as jest.Mock;

/** Status written by the last `onRampSwap.update` call. */
const lastWrittenStatus = (): string | undefined => mockUpdate.mock.calls.at(-1)?.[0]?.data?.status;

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateMany.mockResolvedValue({ count: 1 });
  mockFindUnique.mockResolvedValue({
    id: "swap-1",
    userId: "user-1",
    stellarAddress: "GSTELLAR",
    usdcAmount: "100",
    source: "usdc_deposit",
    status: "processing",
    xlmAmount: null,
  });
  mockUpdate.mockResolvedValue({});
});

describe("processUsdcConvertAndMint retry handling (AB-019)", () => {
  it("returns the swap to pending_convert when a retryable attempt fails", async () => {
    mockSwap.mockRejectedValue(new Error("DEX unreachable"));

    await expect(processUsdcConvertAndMint({ onRampSwapId: "swap-1" })).rejects.toThrow(
      "DEX unreachable",
    );

    expect(lastWrittenStatus()).toBe("pending_convert");
  });

  it("leaves the swap claimable so the redelivered message can claim it again", async () => {
    mockSwap.mockRejectedValue(new Error("DEX unreachable"));
    await expect(processUsdcConvertAndMint({ onRampSwapId: "swap-1" })).rejects.toThrow();

    // The retry requires the claim predicate to match, not just the status to
    // be reverted, so assert the where-clause the next attempt will use.
    mockSwap.mockReset();
    mockSwap.mockResolvedValue({ xlmReceived: 497.25, txHash: "swap-tx" });
    mockMint.mockResolvedValue({ transactionId: "tx-1", acbuAmount: "95" });

    await processUsdcConvertAndMint({ onRampSwapId: "swap-1" });

    expect(mockMint).toHaveBeenCalledWith(100, "GSTELLAR", "user-1");
    expect(mockUpdateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "swap-1", status: "pending_convert" }),
      }),
    );
    expect(lastWrittenStatus()).toBe("completed");
  });

  it("parks the swap in failed only on the last attempt", async () => {
    mockSwap.mockRejectedValue(new Error("DEX unreachable"));

    await expect(
      processUsdcConvertAndMint({ onRampSwapId: "swap-1" }, { finalAttempt: true }),
    ).rejects.toThrow("DEX unreachable");

    expect(lastWrittenStatus()).toBe("failed");
    expect(mockMint).not.toHaveBeenCalled();
  });

  it("does not repeat the on-chain swap when an earlier attempt already swapped", async () => {
    mockFindUnique.mockResolvedValue({
      id: "swap-1",
      userId: "user-1",
      stellarAddress: "GSTELLAR",
      usdcAmount: "100",
      source: "usdc_deposit",
      status: "processing",
      xlmAmount: "497.25",
    });
    mockMint.mockResolvedValue({ transactionId: "tx-1", acbuAmount: "95" });

    await processUsdcConvertAndMint({ onRampSwapId: "swap-1" });

    expect(mockSwap).not.toHaveBeenCalled();
    expect(mockMint).toHaveBeenCalledWith(100, "GSTELLAR", "user-1");
    expect(lastWrittenStatus()).toBe("completed");
  });

  it("still performs the DEX swap on a first attempt", async () => {
    mockSwap.mockResolvedValue({ xlmReceived: 497.25, txHash: "swap-tx" });
    mockMint.mockResolvedValue({ transactionId: "tx-1", acbuAmount: "95" });

    await processUsdcConvertAndMint({ onRampSwapId: "swap-1" });

    expect(mockSwap).toHaveBeenCalledWith(100);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "swap-1" },
      data: { xlmAmount: expect.anything() },
    });
  });

  it("keeps a swap without a usdcAmount terminally failed", async () => {
    mockFindUnique.mockResolvedValue({
      id: "swap-1",
      userId: "user-1",
      stellarAddress: "GSTELLAR",
      usdcAmount: null,
      source: "usdc_deposit",
      status: "processing",
      xlmAmount: null,
    });

    await processUsdcConvertAndMint({ onRampSwapId: "swap-1" });

    expect(mockSwap).not.toHaveBeenCalled();
    expect(lastWrittenStatus()).toBe("failed");
  });
});
