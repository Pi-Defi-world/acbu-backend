import fs from "fs";
import os from "os";
import path from "path";

describe("logFinancialEvent — invalid payload handling (#791)", () => {
  let tmpDir: string;

  const loadModule = () => {
    // Reset the module registry so config/env and logger re-read LOG_FILE.
    jest.resetModules();
    process.env.LOG_FILE = path.join(tmpDir, "app.log");
    return require("../src/config/logger") as typeof import("../src/config/logger");
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acbu-dlq-"));
  });

  afterEach(() => {
    delete process.env.LOG_FILE;
    jest.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const validPayload = {
    event: "transfer.initiated",
    amount: 1000,
    currency: "NGN",
    userId: "user-1",
    accountId: "acct-1",
    idempotencyKey: "idem-1",
    transactionId: "tx-1",
    status: "pending" as const,
    correlationId: "corr-1",
  };

  it("raises an error-level alert when required fields are missing", () => {
    const { logger, logFinancialEvent } = loadModule();
    const errorSpy = jest.spyOn(logger, "error");
    const warnSpy = jest.spyOn(logger, "warn");

    logFinancialEvent({ ...validPayload, userId: undefined } as never);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message] = errorSpy.mock.calls[0];
    expect(message).toContain("missing required fields");
    // The old behaviour logged a mere warn — it must not be used anymore.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("persists the partial record in the audit DLQ instead of dropping it", () => {
    const { logger, logFinancialEvent, getFinancialEventDlqFilePath } = loadModule();
    jest.spyOn(logger, "error");

    logFinancialEvent({
      ...validPayload,
      transactionId: "",
      currency: undefined,
    } as never);

    const dlqPath = getFinancialEventDlqFilePath();
    expect(fs.existsSync(dlqPath)).toBe(true);

    const lines = fs.readFileSync(dlqPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);

    const record = JSON.parse(lines[0]);
    expect(record.reason).toBe("missing_required_fields");
    expect(record.missing).toEqual(expect.arrayContaining(["currency", "transactionId"]));
    expect(record.event.event).toBe("transfer.initiated");
    expect(record.event.userId).toBe("user-1");
    expect(typeof record.dlqTimestamp).toBe("string");
  });

  it("appends each invalid event as its own DLQ record", () => {
    const { logger, logFinancialEvent, getFinancialEventDlqFilePath } = loadModule();
    jest.spyOn(logger, "error");

    logFinancialEvent({ ...validPayload, amount: undefined } as never);
    logFinancialEvent({ ...validPayload, status: "" } as never);

    const lines = fs.readFileSync(getFinancialEventDlqFilePath(), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).missing).toEqual(["amount"]);
    expect(JSON.parse(lines[1]).missing).toEqual(["status"]);
  });

  it("redacts PII in the partial record written to the DLQ", () => {
    const { logger, logFinancialEvent, getFinancialEventDlqFilePath } = loadModule();
    jest.spyOn(logger, "error");

    logFinancialEvent({
      ...validPayload,
      provider: "card 4111111111111111 charged",
      errorCode: undefined,
    } as never);

    const raw = fs.readFileSync(getFinancialEventDlqFilePath(), "utf8");
    expect(raw).not.toContain("4111111111111111");
    expect(JSON.parse(raw.trim()).event.provider).toContain("[REDACTED]");
  });

  it("does not write to the DLQ for valid events", () => {
    const { logger, logFinancialEvent, getFinancialEventDlqFilePath } = loadModule();
    const infoSpy = jest.spyOn(logger, "info");

    logFinancialEvent(validPayload);

    expect(infoSpy).toHaveBeenCalledWith("financial_event", expect.objectContaining({ event: "transfer.initiated" }));
    expect(fs.existsSync(getFinancialEventDlqFilePath())).toBe(false);
  });
});
