const mockCall = jest.fn<Promise<{ records: Record<string, unknown>[] }>, []>();
const mockOrder = jest.fn();
const mockLimit = jest.fn();
const mockCursor = jest.fn();
const mockForContract = jest.fn();
const mockAssertQueue = jest.fn();
const mockSendToQueue = jest.fn();
const mockGetServer = jest.fn();
const mockLedgerCall = jest.fn();
const mockLedger = jest.fn();

const mockBuilder = {
  order: mockOrder,
  limit: mockLimit,
  cursor: mockCursor,
  call: mockCall,
};

mockOrder.mockReturnValue(mockBuilder);
mockLimit.mockReturnValue(mockBuilder);
mockCursor.mockReturnValue(mockBuilder);
mockForContract.mockReturnValue(mockBuilder);
mockGetServer.mockImplementation(() => ({
  effects: () => ({
    forContract: mockForContract,
  }),
  ledgers: () => ({
    ledger: mockLedger,
  }),
}));

jest.mock("./client", () => ({
  stellarClient: {
    getServer: mockGetServer,
  },
}));

jest.mock("../../config/rabbitmq", () => ({
  connectRabbitMQ: jest.fn(async () => ({
    assertQueue: mockAssertQueue,
    sendToQueue: mockSendToQueue,
  })),
  QUEUES: {
    STELLAR_EVENT_FAILURES_DLQ: "stellar_event_failures_dlq",
  },
}));

jest.mock("../../config/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { EventListener } from "./eventListener";

describe("EventListener", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrder.mockReturnValue(mockBuilder);
    mockLimit.mockReturnValue(mockBuilder);
    mockCursor.mockReturnValue(mockBuilder);
    mockForContract.mockReturnValue(mockBuilder);
    mockCall.mockResolvedValue({ records: [] });
    mockLedger.mockImplementation((seq: number) => ({
      call: () => mockLedgerCall(seq),
    }));
    mockLedgerCall.mockImplementation(async (seq: number) => ({
      hash: `hash-${seq}`,
      prev_hash: `hash-${seq - 1}`,
    }));
  });

  it("polls registered contract IDs through forContract instead of the broad effects stream", async () => {
    const listener = new EventListener();
    listener.listenToContractEvents("contract-123", ["contract_credited"], async () => {});

    await listener.pollOnce();

    expect(mockForContract).toHaveBeenCalledWith("contract-123");
    expect(mockForContract).toHaveBeenCalledTimes(1);
  });

  it("attaches a schema version to parsed contract events", async () => {
    const listener = new EventListener();
    const received: unknown[] = [];

    listener.listenToContractEvents("contract-123", ["contract_credited"], async (event) => {
      received.push(event);
    });

    await listener.dispatchRawEffect("contract-123", {
      contract: "contract-123",
      type: "contract_credited",
      ledger: 88,
      created_at: "2026-04-23T00:00:00.000Z",
      paging_token: "cursor-88",
    });

    expect(received).toHaveLength(1);
    expect((received[0] as Record<string, unknown>).version).toBe(1);
  });

  it("exposes Soroban event listener health status", async () => {
    const listener = new EventListener();
    listener.listenToContractEvents("contract-123", ["contract_credited"], async () => {});

    await listener.pollOnce();

    expect(listener.getHealthStatus().status).toBe("up");
    expect(listener.getHealthStatus().lastHealthyAt).toBeGreaterThan(0);
  });

  it("retries transient handler failures so injected events still reach the projection store", async () => {
    const listener = new EventListener();
    const projectionStore: string[] = [];
    let attempts = 0;

    listener.listenToContractEvents("contract-123", ["contract_credited"], async (event) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("temporary projection error");
      }
      projectionStore.push(`${event.contractId}:${event.type}:${event.ledger}`);
    });

    await listener.dispatchRawEffect("contract-123", {
      contract: "contract-123",
      type: "contract_credited",
      ledger: 88,
      created_at: "2026-04-23T00:00:00.000Z",
      paging_token: "cursor-88",
    });

    expect(attempts).toBe(2);
    expect(projectionStore).toEqual(["contract-123:contract_credited:88"]);
    expect(mockSendToQueue).not.toHaveBeenCalled();
  });

  it("captures parse failures to the stellar event DLQ", async () => {
    const listener = new EventListener();

    await listener.dispatchRawEffect("contract-123", {
      contract: "contract-123",
      ledger: 55,
      created_at: "2026-04-23T00:00:00.000Z",
    });

    expect(mockAssertQueue).toHaveBeenCalledWith("stellar_event_failures_dlq", {
      durable: true,
    });
    expect(mockSendToQueue).toHaveBeenCalledTimes(1);
    const payload = JSON.parse((mockSendToQueue.mock.calls[0][1] as Buffer).toString("utf8"));
    expect(payload).toMatchObject({
      reason: "parse_failure",
      registeredContractId: "contract-123",
    });
  });
  describe("ledger continuity", () => {
    const effect = (ledger: number) => ({
      contract: "contract-123",
      type: "contract_credited",
      ledger,
      created_at: "2026-04-23T00:00:00.000Z",
      paging_token: `cursor-${ledger}`,
    });

    it("dispatches events once ledger hashes are verified", async () => {
      const listener = new EventListener();
      const received: number[] = [];
      listener.listenToContractEvents("contract-123", ["contract_credited"], async (e) => {
        received.push(e.ledger);
      });
      mockCall.mockResolvedValueOnce({ records: [effect(100), effect(101)] });

      await listener.pollOnce();

      expect(received).toEqual([100, 101]);
      expect(mockLedgerCall).toHaveBeenCalledWith(100);
      expect(mockLedgerCall).toHaveBeenCalledWith(101);
    });

    it("rewinds and skips the batch when a confirmed ledger hash changes", async () => {
      const listener = new EventListener();
      const received: number[] = [];
      listener.listenToContractEvents("contract-123", ["contract_credited"], async (e) => {
        received.push(e.ledger);
      });

      mockCall.mockResolvedValueOnce({ records: [effect(100)] });
      await listener.pollOnce();
      expect(received).toEqual([100]);

      // Ledger 100 is replaced on the network; next batch must not be committed.
      mockLedgerCall.mockImplementation(async (seq: number) => ({
        hash: seq === 100 ? "forked-hash-100" : `hash-${seq}`,
        prev_hash: `hash-${seq - 1}`,
      }));
      mockCall.mockResolvedValueOnce({ records: [effect(101)] });
      await listener.pollOnce();

      expect(received).toEqual([100]);
      expect(mockSendToQueue).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(mockSendToQueue.mock.calls[0][1].toString());
      expect(payload.reason).toBe("ledger_reorg");
      expect(payload.rewindToLedger).toBe(100);
    });

    it("rejects a ledger whose prev_hash does not match the confirmed parent", async () => {
      const listener = new EventListener();
      const received: number[] = [];
      listener.listenToContractEvents("contract-123", ["contract_credited"], async (e) => {
        received.push(e.ledger);
      });

      mockCall.mockResolvedValueOnce({ records: [effect(100)] });
      await listener.pollOnce();

      mockLedgerCall.mockImplementation(async (seq: number) => ({
        hash: `hash-${seq}`,
        prev_hash: seq === 101 ? "unexpected-parent" : `hash-${seq - 1}`,
      }));
      mockCall.mockResolvedValueOnce({ records: [effect(101)] });
      await listener.pollOnce();

      expect(received).toEqual([100]);
    });

    it("rejects batches that go behind already confirmed ledgers", async () => {
      const listener = new EventListener();
      const received: number[] = [];
      listener.listenToContractEvents("contract-123", ["contract_credited"], async (e) => {
        received.push(e.ledger);
      });

      mockCall.mockResolvedValueOnce({ records: [effect(100), effect(105)] });
      await listener.pollOnce();
      mockCall.mockResolvedValueOnce({ records: [effect(102)] });
      await listener.pollOnce();

      expect(received).toEqual([100, 105]);
    });
  });
});
