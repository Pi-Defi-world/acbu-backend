const mockListenToContractEvents = jest.fn();
const mockFindFirst = jest.fn();
const mockEnqueueUsdcConversion = jest.fn();

jest.mock("../services/stellar/eventListener", () => ({
  eventListener: {
    listenToContractEvents: mockListenToContractEvents,
  },
}));

jest.mock("../config/contracts", () => ({
  getContractAddresses: jest.fn(() => ({ minting: "minting-contract" })),
}));

jest.mock("../config/database", () => ({
  prisma: {
    transaction: {
      findFirst: mockFindFirst,
    },
  },
}));

jest.mock("./usdcConversionJob", () => ({
  enqueueUsdcConversion: mockEnqueueUsdcConversion,
}));

jest.mock("../config/logger", () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

import { startMintEventListener } from "./acbu_minting_event_listener";

describe("startMintEventListener", () => {
  const validTxHash = "a".repeat(64);
  const recipient = "G".repeat(56);

  beforeEach(() => {
    jest.clearAllMocks();
    mockFindFirst.mockResolvedValue({ id: "transaction-1" });
    mockEnqueueUsdcConversion.mockResolvedValue(undefined);
  });

  async function getHandler(): Promise<(event: Record<string, unknown>) => Promise<void>> {
    await startMintEventListener();
    return mockListenToContractEvents.mock.calls[0][2];
  }

  it("skips effects without a real transaction hash", async () => {
    const handler = await getHandler();

    await handler({
      data: { amount: "10", account: recipient, id: "effect-123" },
      ledger: 123,
    });

    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockEnqueueUsdcConversion).not.toHaveBeenCalled();
  });

  it("enqueues effects using the real transaction hash and matching transaction", async () => {
    const handler = await getHandler();

    await handler({
      data: {
        amount: "10",
        account: recipient,
        transaction_id: validTxHash,
      },
      ledger: 123,
    });

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        type: "mint",
        blockchainTxHash: validTxHash,
        status: { in: ["pending", "processing"] },
      },
      select: { id: true },
    });
    expect(mockEnqueueUsdcConversion).toHaveBeenCalledWith({
      usdcAmount: "10",
      recipient,
      txHash: validTxHash,
      transactionId: "transaction-1",
    });
  });
});