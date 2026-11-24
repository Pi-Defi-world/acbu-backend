const mockListenToContractEvents = jest.fn();
const mockFindFirst = jest.fn();
const mockEnqueueWithdrawalProcessing = jest.fn();

jest.mock("../services/stellar/eventListener", () => ({
  eventListener: {
    listenToContractEvents: mockListenToContractEvents,
  },
}));

jest.mock("../config/contracts", () => ({
  getContractAddresses: jest.fn(() => ({ burning: "burning-contract" })),
}));

jest.mock("../config/database", () => ({
  prisma: {
    transaction: {
      findFirst: mockFindFirst,
    },
  },
}));

jest.mock("./withdrawalProcessingJob", () => ({
  enqueueWithdrawalProcessing: mockEnqueueWithdrawalProcessing,
}));

jest.mock("../config/logger", () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

import { startBurnEventListener } from "./acbu_burning_event_listener";

describe("startBurnEventListener", () => {
  const validTxHash = "b".repeat(64);

  beforeEach(() => {
    jest.clearAllMocks();
    mockFindFirst.mockResolvedValue({ id: "transaction-2" });
    mockEnqueueWithdrawalProcessing.mockResolvedValue(undefined);
  });

  async function getHandler(): Promise<(event: Record<string, unknown>) => Promise<void>> {
    await startBurnEventListener();
    return mockListenToContractEvents.mock.calls[0][2];
  }

  it("skips effects without a real transaction hash", async () => {
    const handler = await getHandler();

    await handler({
      data: { amount: "10", id: "effect-123" },
      ledger: 123,
    });

    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockEnqueueWithdrawalProcessing).not.toHaveBeenCalled();
  });

  it("skips effects with a non-hex transaction hash even if it is 64 chars long", async () => {
    const handler = await getHandler();

    await handler({
      data: {
        transaction_hash: "z".repeat(64),
      },
      ledger: 123,
    });

    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockEnqueueWithdrawalProcessing).not.toHaveBeenCalled();
  });

  it("enqueues effects using the real transaction hash and matching transaction", async () => {
    const handler = await getHandler();

    await handler({
      data: {
        transaction_id: validTxHash,
      },
      ledger: 123,
    });

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: {
        type: "burn",
        blockchainTxHash: validTxHash,
        status: { in: ["pending", "processing"] },
      },
      select: { id: true },
    });
    expect(mockEnqueueWithdrawalProcessing).toHaveBeenCalledWith({
      transactionId: "transaction-2",
      txHash: validTxHash,
    });
  });
});
