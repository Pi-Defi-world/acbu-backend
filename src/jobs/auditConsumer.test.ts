import { startAuditConsumer } from "./auditConsumer";
import { prisma } from "../config/database";
import {
  getRabbitMQChannel,
  QUEUES,
  assertQueueWithDLQ,
} from "../config/rabbitmq";

jest.mock("../config/database", () => ({
  prisma: {
    auditTrail: {
      create: jest.fn(),
    },
  },
}));

jest.mock("../config/rabbitmq", () => ({
  getRabbitMQChannel: jest.fn(),
  assertQueueWithDLQ: jest.fn().mockResolvedValue({}),
  QUEUES: {
    AUDIT_LOGS: "audit_logs",
  },
}));

jest.mock("../config/logger", () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

describe("AuditConsumer", () => {
  const mockChannel = {
    consume: jest.fn(),
    ack: jest.fn(),
    nack: jest.fn(),
  };

  const entry = {
    eventType: "USER_LOGIN",
    action: "LOGIN",
    performedBy: "user-1",
    timestamp: new Date().toISOString(),
  };

  const mockMsg = {
    content: Buffer.from(JSON.stringify(entry)),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getRabbitMQChannel as jest.Mock).mockReturnValue(mockChannel);
  });

  it("should consume and save audit entry to database", async () => {
    (prisma.auditTrail.create as jest.Mock).mockResolvedValue({ id: "1" });

    // Trigger the consumer callback manually
    mockChannel.consume.mockImplementation((_queue, callback) => {
      callback(mockMsg);
    });

    await startAuditConsumer();

    expect(assertQueueWithDLQ).toHaveBeenCalledWith(QUEUES.AUDIT_LOGS, {
      durable: true,
    });
    expect(prisma.auditTrail.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: entry.eventType,
          action: entry.action,
        }),
      }),
    );
    expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
  });

  it("should retry on database failure and eventually nack to DLQ", async () => {
    (prisma.auditTrail.create as jest.Mock).mockRejectedValue(
      new Error("DB connection failed"),
    );
    // Fast forward timers for retry
    jest.useFakeTimers();

    mockChannel.consume.mockImplementation((_queue, callback) => {
      callback(mockMsg);
    });

    await startAuditConsumer();

    // We need to resolve the promises inside the loop
    for (let i = 0; i < 4; i++) {
      await Promise.resolve(); // allow the loop to run
      jest.runAllTimers();
      await Promise.resolve();
    }

    expect(prisma.auditTrail.create).toHaveBeenCalledTimes(4); // 0, 1, 2, 3
    expect(mockChannel.nack).toHaveBeenCalledWith(mockMsg, false, false);

    jest.useRealTimers();
  });
});
