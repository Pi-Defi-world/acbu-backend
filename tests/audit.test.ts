jest.mock("../src/config/rabbitmq", () => ({
  getRabbitMQChannel: jest.fn(),
  QUEUES: { AUDIT_LOGS: "audit_logs" },
}));

jest.mock("../src/config/mongodb", () => ({
  getMongoDB: jest.fn(),
}));

jest.mock("../src/services/notification", () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/config/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("fs", () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
}));

// Keep sleep fast in tests
jest.mock("../src/config/env", () => ({
  config: {
    logFile: "logs/app.log",
    notification: { alertEmail: "admin@example.com" },
  },
}));

import { getRabbitMQChannel } from "../src/config/rabbitmq";
import { getMongoDB } from "../src/config/mongodb";
import { sendEmail } from "../src/services/notification";
import { logger } from "../src/config/logger";
import fs from "fs";
import { logAudit, type AuditEntry } from "../src/services/audit/auditService";

const mockGetChannel = getRabbitMQChannel as jest.Mock;
const mockGetMongoDB = getMongoDB as jest.Mock;
const mockSendEmail = sendEmail as jest.Mock;
const mockLogger = logger as jest.Mocked<typeof logger>;
const mockFs = fs as jest.Mocked<typeof fs>;

const entry: AuditEntry = {
  eventType: "user.login",
  action: "login",
  entityType: "user",
  entityId: "user-1",
  performedBy: "user-1",
};

const mockInsertOne = jest.fn().mockResolvedValue({ insertedId: "oid-1" });
const mockCollection = jest.fn().mockReturnValue({ insertOne: mockInsertOne });

function makeSendToQueue(returns: boolean): jest.Mock {
  return jest.fn().mockReturnValue(returns);
}

describe("logAudit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: healthy channel
    mockGetChannel.mockReturnValue({ sendToQueue: makeSendToQueue(true) });
    // Default: healthy mongo
    mockGetMongoDB.mockReturnValue({ collection: mockCollection });
  });

  // ── happy path ───────────────────────────────────────────────────────────────

  it("publishes to RabbitMQ on first attempt and returns", async () => {
    await logAudit(entry);

    expect(mockGetChannel).toHaveBeenCalledTimes(1);
    expect(mockInsertOne).not.toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      "Audit entry published to queue",
      expect.objectContaining({ eventType: entry.eventType, attempt: 1 }),
    );
  });

  it("includes a timestamp in the published payload", async () => {
    const sendToQueue = makeSendToQueue(true);
    mockGetChannel.mockReturnValue({ sendToQueue });

    await logAudit(entry);

    const raw = sendToQueue.mock.calls[0][1] as Buffer;
    const payload = JSON.parse(raw.toString()) as Record<string, unknown>;
    expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(payload.eventType).toBe(entry.eventType);
  });

  // ── retry logic ──────────────────────────────────────────────────────────────

  it("retries and succeeds on second attempt", async () => {
    const sendToQueue = jest.fn()
      .mockReturnValueOnce(false)   // attempt 1 fails
      .mockReturnValueOnce(true);   // attempt 2 succeeds
    mockGetChannel.mockReturnValue({ sendToQueue });

    await logAudit(entry);

    expect(sendToQueue).toHaveBeenCalledTimes(2);
    expect(mockInsertOne).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("attempt 1 failed"),
      expect.any(Object),
    );
  });

  it("retries and succeeds on third attempt", async () => {
    const sendToQueue = jest.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    mockGetChannel.mockReturnValue({ sendToQueue });

    await logAudit(entry);

    expect(sendToQueue).toHaveBeenCalledTimes(3);
    expect(mockInsertOne).not.toHaveBeenCalled();
  });

  it("retries when getRabbitMQChannel throws", async () => {
    mockGetChannel
      .mockImplementationOnce(() => { throw new Error("not connected"); })
      .mockReturnValue({ sendToQueue: makeSendToQueue(true) });

    await logAudit(entry);

    expect(mockGetChannel).toHaveBeenCalledTimes(2);
    expect(mockInsertOne).not.toHaveBeenCalled();
  });

  // ── chaos test: primary write fails → outbox saves the event ────────────────

  it("[chaos] saves to MongoDB outbox when all RabbitMQ retries fail", async () => {
    // All 3 attempts fail
    mockGetChannel.mockReturnValue({ sendToQueue: makeSendToQueue(false) });

    await logAudit(entry);

    // Event must not be lost — outbox must have received it
    expect(mockCollection).toHaveBeenCalledWith("audit_outbox");
    expect(mockInsertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: entry.eventType,
        action: entry.action,
        failureReason: expect.any(String),
        savedAt: expect.any(Date),
      }),
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("saving to outbox"),
      expect.any(Object),
    );
  });

  it("[chaos] saves to outbox when channel throws on every attempt", async () => {
    mockGetChannel.mockImplementation(() => {
      throw new Error("RabbitMQ down");
    });

    await logAudit(entry);

    expect(mockInsertOne).toHaveBeenCalledTimes(1);
    expect(mockInsertOne).toHaveBeenCalledWith(
      expect.objectContaining({ failureReason: "RabbitMQ down" }),
    );
  });

  // ── outbox failure → file fallback ───────────────────────────────────────────

  it("[chaos] falls back to file when MongoDB outbox also fails", async () => {
    mockGetChannel.mockReturnValue({ sendToQueue: makeSendToQueue(false) });
    mockGetMongoDB.mockImplementation(() => {
      throw new Error("MongoDB down");
    });

    await logAudit(entry);

    expect(mockFs.appendFileSync).toHaveBeenCalledWith(
      expect.stringContaining("lost-audits.log"),
      expect.stringContaining(entry.eventType),
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("falling back to file"),
      expect.any(Object),
    );
  });

  it("[chaos] sends alert email when both RabbitMQ and MongoDB fail", async () => {
    mockGetChannel.mockReturnValue({ sendToQueue: makeSendToQueue(false) });
    mockGetMongoDB.mockImplementation(() => {
      throw new Error("MongoDB down");
    });

    await logAudit(entry);

    expect(mockSendEmail).toHaveBeenCalledWith(
      "admin@example.com",
      expect.stringContaining("CRITICAL"),
      expect.stringContaining(entry.eventType),
    );
  });

  it("[chaos] creates log dir if it does not exist before writing fallback file", async () => {
    mockGetChannel.mockReturnValue({ sendToQueue: makeSendToQueue(false) });
    mockGetMongoDB.mockImplementation(() => { throw new Error("down"); });
    mockFs.existsSync.mockReturnValueOnce(false);

    await logAudit(entry);

    expect(mockFs.mkdirSync).toHaveBeenCalledWith(
      expect.any(String),
      { recursive: true },
    );
    expect(mockFs.appendFileSync).toHaveBeenCalled();
  });

  it("[chaos] logs FATAL when file write also fails", async () => {
    mockGetChannel.mockReturnValue({ sendToQueue: makeSendToQueue(false) });
    mockGetMongoDB.mockImplementation(() => { throw new Error("down"); });
    mockFs.appendFileSync.mockImplementationOnce(() => {
      throw new Error("disk full");
    });

    await logAudit(entry);

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("FATAL"),
      expect.any(Object),
    );
  });

  it("does not send alert email when alertEmail is not configured", async () => {
    const { config } = await import("../src/config/env");
    const original = config.notification.alertEmail;
    config.notification.alertEmail = "";

    mockGetChannel.mockReturnValue({ sendToQueue: makeSendToQueue(false) });
    mockGetMongoDB.mockImplementation(() => { throw new Error("down"); });

    await logAudit(entry);

    expect(mockSendEmail).not.toHaveBeenCalled();
    config.notification.alertEmail = original;
  });

  it("handles sendEmail rejection without throwing", async () => {
    mockGetChannel.mockReturnValue({ sendToQueue: makeSendToQueue(false) });
    mockGetMongoDB.mockImplementation(() => { throw new Error("down"); });
    mockSendEmail.mockRejectedValueOnce(new Error("SMTP error"));

    // Must not throw even if email fails
    await expect(logAudit(entry)).resolves.toBeUndefined();
  });
});
