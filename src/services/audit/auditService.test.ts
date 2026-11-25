import { logAudit } from "./auditService";
import { logger } from "../../config/logger";
import { sendEmail } from "../notification";
import fs from "fs";
import { config } from "../../config/env";
import { getRabbitMQChannel, QUEUES } from "../../config/rabbitmq";

jest.mock("../../config/rabbitmq", () => ({
  getRabbitMQChannel: jest.fn(),
  QUEUES: {
    AUDIT_LOGS: "audit_logs",
  },
}));

jest.mock("../../config/env", () => ({
  config: {
    logFile: "/tmp/audit-test.log",
    notification: { alertEmail: null },
  },
}));

jest.mock("../notification", () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../config/logger", () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  },
}));

describe("AuditService Reliability (RabbitMQ)", () => {
  const entry = {
    eventType: "USER_LOGIN",
    action: "LOGIN",
    performedBy: "user-1",
  };

  const mockChannel = {
    sendToQueue: jest.fn(),
    waitForConfirms: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getRabbitMQChannel as jest.Mock).mockReturnValue(mockChannel);
    mockChannel.waitForConfirms.mockResolvedValue(undefined);
  });

  it("should publish to RabbitMQ successfully", async () => {
    mockChannel.sendToQueue.mockReturnValue(true);

    await logAudit(entry);

    expect(mockChannel.sendToQueue).toHaveBeenCalledWith(QUEUES.AUDIT_LOGS, expect.any(Buffer), {
      persistent: true,
    });
    expect(mockChannel.waitForConfirms).toHaveBeenCalled();
    const envelope = JSON.parse((mockChannel.sendToQueue.mock.calls[0][1] as Buffer).toString());
    expect(envelope).toEqual(
      expect.objectContaining({
        version: 1,
        type: QUEUES.AUDIT_LOGS,
        payload: expect.objectContaining({
          eventType: entry.eventType,
          action: entry.action,
        }),
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("Audit entry published to queue"),
      expect.anything(),
    );
  });

  it("should wait for broker confirmation when the channel applies backpressure", async () => {
    mockChannel.sendToQueue.mockReturnValue(false);

    await logAudit(entry);

    expect(mockChannel.sendToQueue).toHaveBeenCalledTimes(1);
    expect(mockChannel.waitForConfirms).toHaveBeenCalledTimes(1);
  });

  it("should record admin audit entries with missing attribution without throwing", async () => {
    mockChannel.sendToQueue.mockReturnValue(true);

    await expect(
      logAudit({
        eventType: "auth",
        action: "admin_key_issued",
        keyType: "ADMIN_KEY",
        performedBy: "user-1",
        actorType: "sme",
        // organizationId and reason intentionally missing
      }),
    ).resolves.toBeUndefined();

    // The attempted action must still be recorded (AB-018)
    expect(mockChannel.sendToQueue).toHaveBeenCalledWith(QUEUES.AUDIT_LOGS, expect.any(Buffer), {
      persistent: true,
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("missing required attribution fields"),
      expect.objectContaining({
        missingFields: expect.arrayContaining(["organizationId", "reason"]),
      }),
    );

    const raw = mockChannel.sendToQueue.mock.calls[0][1] as Buffer;
    const envelope = JSON.parse(raw.toString());
    const payload = envelope.payload as Record<string, unknown>;
    expect(payload.attributionError).toContain("organizationId");
    expect(payload.attributionError).toContain("reason");
    expect(payload.performedBy).toBe("user-1");
  });

  it("should publish admin audit entries when required attribution fields are present", async () => {
    mockChannel.sendToQueue.mockReturnValue(true);

    await logAudit({
      eventType: "auth",
      action: "admin_key_issued",
      keyType: "ADMIN_KEY",
      performedBy: "user-1",
      actorType: "sme",
      organizationId: "org-1",
      reason: "Emergency access",
    });

    expect(mockChannel.sendToQueue).toHaveBeenCalledWith(QUEUES.AUDIT_LOGS, expect.any(Buffer), {
      persistent: true,
    });
  });

  it("should fall back to file if the broker rejects the published message", async () => {
    mockChannel.waitForConfirms.mockRejectedValue(new Error("Broker rejected message"));

    // Mock FS
    const appendFileSyncSpy = jest.spyOn(fs, "appendFileSync").mockImplementation(() => {});
    const mkdirSyncSpy = jest.spyOn(fs, "mkdirSync").mockImplementation(() => "");
    const existsSyncSpy = jest.spyOn(fs, "existsSync").mockReturnValue(true);

    await expect(logAudit(entry)).rejects.toThrow("Broker rejected message");

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Audit publish failed after 3 retries"),
      expect.anything(),
    );
    expect(appendFileSyncSpy).toHaveBeenCalled();
    expect(mockChannel.sendToQueue).toHaveBeenCalledTimes(3);
    expect(mockChannel.waitForConfirms).toHaveBeenCalledTimes(3);

    appendFileSyncSpy.mockRestore();
    mkdirSyncSpy.mockRestore();
    existsSyncSpy.mockRestore();
  });

  it("should fall back to file if RabbitMQ throws error", async () => {
    (getRabbitMQChannel as jest.Mock).mockImplementation(() => {
      throw new Error("RabbitMQ Down");
    });

    // Mock FS
    const appendFileSyncSpy = jest.spyOn(fs, "appendFileSync").mockImplementation(() => {});
    const mkdirSyncSpy = jest.spyOn(fs, "mkdirSync").mockImplementation(() => "");
    const existsSyncSpy = jest.spyOn(fs, "existsSync").mockReturnValue(true);

    // Set alert email in config for this test
    const originalAlertEmail = config.notification.alertEmail;
    config.notification.alertEmail = "admin@example.com";

    await expect(logAudit(entry)).rejects.toThrow("RabbitMQ Down");

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Audit publish failed after 3 retries"),
      expect.anything(),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("CRITICAL: Audit outbox write failed"),
      expect.anything(),
    );
    expect(appendFileSyncSpy).toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledWith(
      "admin@example.com",
      expect.stringContaining("CRITICAL: Audit Log System Failure"),
      expect.anything(),
    );

    // Restore
    config.notification.alertEmail = originalAlertEmail;
    appendFileSyncSpy.mockRestore();
    mkdirSyncSpy.mockRestore();
    existsSyncSpy.mockRestore();
  });
});
