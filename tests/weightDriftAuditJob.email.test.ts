/**
 * AB-045 (#995): the weekly weight-drift audit report must be addressed to the
 * admins configured through `config.notification.alertEmail`.
 *
 * The key is backed by NOTIFICATION_ALERT_EMAIL (declared in src/config/env.ts).
 * These tests pin the destination wiring and the skip/error behaviour so a
 * future rename back to a non-existent key (e.g. ADMIN_NOTIFICATION_EMAIL)
 * fails loudly instead of silently dropping the report.
 */

const mockCalculateDriftReport = jest.fn();
const mockCreateAudit = jest.fn();
const mockSendEmail = jest.fn();

jest.mock("../src/services/reserve/WeightDriftAuditService", () => ({
  weightDriftAuditService: {
    calculateDriftReport: (...args: unknown[]) => mockCalculateDriftReport(...args),
    createAudit: (...args: unknown[]) => mockCreateAudit(...args),
  },
}));

jest.mock("../src/services/notification", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../src/config/env", () => ({
  config: { notification: { alertEmail: "ops@example.com,admin@example.com" } },
}));

import { config } from "../src/config/env";
import { logger } from "../src/config/logger";
import { parseAlertRecipients, runWeightDriftAuditOnce } from "../src/jobs/weightDriftAuditJob";

const mockLoggerInfo = logger.info as jest.Mock;
const mockLoggerWarn = logger.warn as jest.Mock;

function makeAudit(overrides: Record<string, unknown> = {}) {
  return {
    auditId: "audit-1",
    status: "pending",
    auditPeriodStart: new Date("2026-09-01T00:00:00.000Z"),
    auditPeriodEnd: new Date("2026-09-08T00:00:00.000Z"),
    totalCurrencies: 2,
    currenciesExceedingThreshold: 1,
    maxDriftPercent: 4.2,
    entries: [
      {
        currency: "USD",
        policyWeight: 50,
        actualWeight: 54.2,
        driftPercent: 4.2,
        exceedsThreshold: true,
      },
      {
        currency: "NGN",
        policyWeight: 50,
        actualWeight: 47.1,
        driftPercent: -2.9,
        exceedsThreshold: true,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (config.notification as { alertEmail?: string }).alertEmail = "ops@example.com,admin@example.com";
  mockCalculateDriftReport.mockResolvedValue({ totalCurrencies: 2, currenciesExceedingThreshold: 1, maxDriftPercent: 4.2 });
  mockCreateAudit.mockResolvedValue(makeAudit());
  mockSendEmail.mockResolvedValue(undefined);
});

describe("runWeightDriftAuditOnce - email destination", () => {
  it("sends the report to every configured admin and reports the real recipient count", async () => {
    await runWeightDriftAuditOnce();

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      "ops@example.com,admin@example.com",
      "[ACBU] Weekly Weight Drift Audit - ACTION REQUIRED",
      expect.stringContaining("Weight Drift Audit Report"),
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith("Weight drift audit email sent", {
      auditId: "audit-1",
      recipientCount: 2,
    });
  });

  it("uses the OK subject when no currency exceeds the drift threshold", async () => {
    mockCreateAudit.mockResolvedValue(makeAudit({ currenciesExceedingThreshold: 0, entries: [] }));

    await runWeightDriftAuditOnce();

    expect(mockSendEmail).toHaveBeenCalledWith(
      "ops@example.com,admin@example.com",
      "[ACBU] Weekly Weight Drift Audit - OK",
      expect.any(String),
    );
  });

  it("skips the email and warns when NOTIFICATION_ALERT_EMAIL is not configured", async () => {
    (config.notification as { alertEmail?: string }).alertEmail = undefined;

    await runWeightDriftAuditOnce();

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "Weight drift audit email skipped: NOTIFICATION_ALERT_EMAIL is not configured",
      { auditId: "audit-1" },
    );
  });

  it("logs a warning but does not throw when the email send fails", async () => {
    const sendError = new Error("smtp unavailable");
    mockSendEmail.mockRejectedValue(sendError);

    await expect(runWeightDriftAuditOnce()).resolves.toBeUndefined();

    expect(mockLoggerWarn).toHaveBeenCalledWith("Failed to send weight drift audit email", {
      auditId: "audit-1",
      error: sendError,
    });
  });
});

describe("parseAlertRecipients", () => {
  const cases: Array<[string | null | undefined, string[]]> = [
    [undefined, []],
    [null, []],
    ["", []],
    ["   ", []],
    ["ops@example.com", ["ops@example.com"]],
    [" ops@example.com , admin@example.com ", ["ops@example.com", "admin@example.com"]],
    ["ops@example.com,,admin@example.com,", ["ops@example.com", "admin@example.com"]],
  ];

  it.each(cases)("normalises %p into %p", (raw, expected) => {
    expect(parseAlertRecipients(raw)).toEqual(expected);
  });
});
