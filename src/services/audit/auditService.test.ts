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
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getRabbitMQChannel as jest.Mock).mockReturnValue(mockChannel);
  });

  it("should publish to RabbitMQ successfully", async () => {
    mockChannel.sendToQueue.mockReturnValue(true);

    await logAudit(entry);

    expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
      QUEUES.AUDIT_LOGS,
      expect.any(Buffer),
      { persistent: true },
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("Audit entry published to queue"),
      expect.anything(),
    );
  });

  it("should reject publishing admin audit entries with missing attribution fields", async () => {
    mockChannel.sendToQueue.mockReturnValue(true);

    const appendFileSyncSpy = jest
      .spyOn(fs, "appendFileSync")
      .mockImplementation(() => {});
    const existsSyncSpy = jest.spyOn(fs, "existsSync").mockReturnValue(true);

    await logAudit({
      eventType: "auth",
      action: "admin_key_issued",
      keyType: "ADMIN_KEY",
      performedBy: "user-1",
      actorType: "sme",
      // organizationId and reason intentionally missing
    });

    expect(mockChannel.sendToQueue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("RabbitMQ audit publish failed"),
      expect.anything(),
    );
    expect(appendFileSyncSpy).toHaveBeenCalled();

    appendFileSyncSpy.mockRestore();
    existsSyncSpy.mockRestore();
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

    expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
      QUEUES.AUDIT_LOGS,
      expect.any(Buffer),
      { persistent: true },
    );
  });

  it("should fall back to file if publish fails (returns false)", async () => {
    mockChannel.sendToQueue.mockReturnValue(false);

    // Mock FS
    const appendFileSyncSpy = jest
      .spyOn(fs, "appendFileSync")
      .mockImplementation(() => {});
    const mkdirSyncSpy = jest
      .spyOn(fs, "mkdirSync")
      .mockImplementation(() => "");
    const existsSyncSpy = jest.spyOn(fs, "existsSync").mockReturnValue(true);

    await logAudit(entry);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("RabbitMQ audit publish failed"),
      expect.anything(),
    );
    expect(appendFileSyncSpy).toHaveBeenCalled();

    appendFileSyncSpy.mockRestore();
    mkdirSyncSpy.mockRestore();
    existsSyncSpy.mockRestore();
  });

  it("should fall back to file if RabbitMQ throws error", async () => {
    (getRabbitMQChannel as jest.Mock).mockImplementation(() => {
      throw new Error("RabbitMQ Down");
    });

    // Mock FS
    const appendFileSyncSpy = jest
      .spyOn(fs, "appendFileSync")
      .mockImplementation(() => {});
    const mkdirSyncSpy = jest
      .spyOn(fs, "mkdirSync")
      .mockImplementation(() => "");
    const existsSyncSpy = jest.spyOn(fs, "existsSync").mockReturnValue(true);

    // Set alert email in config for this test
    const originalAlertEmail = config.notification.alertEmail;
    config.notification.alertEmail = "admin@example.com";

    await logAudit(entry);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("CRITICAL: Audit logging failed"),
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
