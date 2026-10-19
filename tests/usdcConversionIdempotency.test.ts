/**
 * Tests: USDC conversion job idempotency (Pi-Defi-world/acbu-backend#981).
 * The same source txHash delivered twice (at-least-once queue semantics) must
 * not double-count reserves; reserve history rows must always be linked to
 * the claimed transaction.
 */

// ── mocks ───────────────────────────────────────────────────────────────────

const mockChannel = {
  prefetch: jest.fn(),
  consume: jest.fn(),
  ack: jest.fn(),
  nack: jest.fn(),
  sendToQueue: jest.fn(),
};

const mockTransactionUpdateMany = jest.fn();
const mockTransactionUpdate = jest.fn();
const mockReserveHistoryCreate = jest.fn();

jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../src/config/rabbitmq", () => ({
  connectRabbitMQ: jest.fn(async () => mockChannel),
  QUEUES: { USDC_CONVERSION: "usdc-conversion" },
  assertQueueWithDLQ: jest.fn(),
}));

jest.mock("../src/jobs/queueConfig", () => ({
  getQueueMaxRetries: () => 5,
}));

jest.mock("../src/config/database", () => ({
  prisma: {
    transaction: {
      updateMany: mockTransactionUpdateMany,
      update: mockTransactionUpdate,
    },
    reserveHistory: { create: mockReserveHistoryCreate },
  },
}));

jest.mock("../src/services/basket", () => ({
  basketService: {
    getCurrentBasket: jest.fn(async () => [
      { currency: "NGN", weight: 50 },
      { currency: "KES", weight: 50 },
    ]),
  },
}));

jest.mock("../src/services/fintech", () => ({
  getFintechRouter: () => ({
    getProvider: async () => ({ convertCurrency: jest.fn() }),
  }),
}));

// ── imports (after mocks) ───────────────────────────────────────────────────

import { startUsdcConversionConsumer } from "../src/jobs/usdcConversionJob";

const txHash = "a".repeat(64);

function makeMessage(payload: Record<string, unknown>) {
  return {
    content: Buffer.from(JSON.stringify(payload)),
    properties: { headers: {} },
  };
}

async function getConsumerCallback(): Promise<(msg: unknown) => Promise<void>> {
  await startUsdcConversionConsumer();
  return mockChannel.consume.mock.calls[0][1];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTransactionUpdateMany.mockResolvedValue({ count: 1 });
  mockTransactionUpdate.mockResolvedValue({});
  mockReserveHistoryCreate.mockResolvedValue({});
});

describe("USDC conversion idempotency (#981)", () => {
  it("creates linked reserve history and completes the transaction on a fresh claim", async () => {
    const callback = await getConsumerCallback();

    await callback(
      makeMessage({
        usdcAmount: "100",
        recipient: "G" + "A".repeat(55),
        txHash,
        transactionId: "tx-1",
      }),
    );

    expect(mockChannel.ack).toHaveBeenCalled();
    // Reserve history is linked to the transaction — no orphan entries.
    expect(mockReserveHistoryCreate).toHaveBeenCalledTimes(2);
    for (const call of mockReserveHistoryCreate.mock.calls) {
      expect(call[0].data.transactionId).toBe("tx-1");
      expect(call[0].data.reason).toBe("conversion");
    }
    expect(mockTransactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tx-1" },
        data: expect.objectContaining({ status: "completed", blockchainTxHash: txHash }),
      }),
    );
  });

  it("drops a duplicate delivery whose transaction was already claimed/completed", async () => {
    const callback = await getConsumerCallback();

    // Another delivery already claimed (or completed) this transaction.
    mockTransactionUpdateMany.mockResolvedValueOnce({ count: 0 });

    await callback(
      makeMessage({
        usdcAmount: "100",
        recipient: "G" + "A".repeat(55),
        txHash,
        transactionId: "tx-1",
      }),
    );

    expect(mockReserveHistoryCreate).not.toHaveBeenCalled();
    expect(mockChannel.ack).toHaveBeenCalled();
    expect(mockTransactionUpdate).not.toHaveBeenCalled();
  });

  it("never writes reserve history without a matched transaction (#982 tie-in)", async () => {
    const callback = await getConsumerCallback();

    await callback(
      makeMessage({
        usdcAmount: "100",
        recipient: "G" + "A".repeat(55),
        txHash,
      }),
    );

    expect(mockReserveHistoryCreate).not.toHaveBeenCalled();
    expect(mockChannel.ack).toHaveBeenCalled();
  });

  it("releases the claim when processing fails so a redelivery can retry", async () => {
    const callback = await getConsumerCallback();

    mockReserveHistoryCreate.mockRejectedValueOnce(new Error("db down"));

    await callback(
      makeMessage({
        usdcAmount: "100",
        recipient: "G" + "A".repeat(55),
        txHash,
        transactionId: "tx-1",
      }),
    );

    // Claim released back to pending for the retry delivery (updateMany on
    // the processing row).
    expect(mockTransactionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tx-1", status: "processing" },
        data: expect.objectContaining({ status: "pending" }),
      }),
    );
    // Message was requeued for retry (first attempt, retries < MAX_RETRIES).
    expect(mockChannel.sendToQueue).toHaveBeenCalled();
    expect(mockChannel.nack).not.toHaveBeenCalled();
  });
});
