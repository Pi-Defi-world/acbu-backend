const mockCall = jest.fn<Promise<{ records: Record<string, unknown>[] }>, []>();
const mockOrder = jest.fn();
const mockLimit = jest.fn();
const mockCursor = jest.fn();
const mockForContract = jest.fn();
const mockAssertQueue = jest.fn();
const mockSendToQueue = jest.fn();

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

jest.mock("./client", () => ({
  stellarClient: {
    getServer: () => ({
      effects: () => ({
        forContract: mockForContract,
      }),
    }),
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
  });

  it("polls registered contract IDs through forContract instead of the broad effects stream", async () => {
    const listener = new EventListener();
    listener.listenToContractEvents(
      "contract-123",
      ["contract_credited"],
      async () => {},
    );

    await listener.pollOnce();

    expect(mockForContract).toHaveBeenCalledWith("contract-123");
    expect(mockForContract).toHaveBeenCalledTimes(1);
  });

  it("retries transient handler failures so injected events still reach the projection store", async () => {
    const listener = new EventListener();
    const projectionStore: string[] = [];
    let attempts = 0;

    listener.listenToContractEvents(
      "contract-123",
      ["contract_credited"],
      async (event) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("temporary projection error");
        }
        projectionStore.push(
          `${event.contractId}:${event.type}:${event.ledger}`,
        );
      },
    );

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
    const payload = JSON.parse(
      (mockSendToQueue.mock.calls[0][1] as Buffer).toString("utf8"),
    );
    expect(payload).toMatchObject({
      reason: "parse_failure",
      registeredContractId: "contract-123",
    });
  });
});
