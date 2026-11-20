/**
 * Unit tests for sendSms() in NotificationService.
 *
 * Covers the provider-dispatch branches: log, twilio, africas_talking
 * (both happy-path and misconfiguration/failure cases).
 *
 * Closes #1180 — AfricasTalking provider was a silent no-op stub.
 */

jest.mock("../src/config/logger", () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock("axios");

// The notification config is read at module load time via `const cfg = config.notification`.
// We mock the entire config module so we can change cfg.smsProvider per test without
// re-requiring the real env schema (which may be missing vars in the test environment).
jest.mock("../src/config/env", () => ({
  config: {
    notification: {
      emailProvider: "log",
      emailFrom: "noreply@acbu.io",
      smtp: { host: "", port: 587, secure: false, user: "", pass: "", maxConnections: 5, maxMessages: 100 },
      sendgridApiKey: undefined,
      sesRegion: "us-east-1",
      sesAccessKeyId: undefined,
      sesSecretAccessKey: undefined,
      smsProvider: "log",
      alertEmail: undefined,
      twilioAccountSid: undefined,
      twilioAuthToken: undefined,
      twilioFromNumber: undefined,
      africasTalkingApiKey: undefined,
      africasTalkingUsername: undefined,
    },
  },
}));

// SMTP helpers are not exercised by sendSms() tests; mock to avoid real transport.
jest.mock("../src/services/email", () => ({
  sendSmtpEmail: jest.fn(),
  sendSmtpEmailBatch: jest.fn(),
}));

import axios from "axios";
import { logger } from "../src/config/logger";
import { config } from "../src/config/env";

const mockAxiosPost = axios.post as jest.Mock;
const mockLoggerInfo = logger.info as jest.Mock;
const mockLoggerError = logger.error as jest.Mock;

// Helper: mutate the mocked notification config between tests.
function setNotificationCfg(overrides: Partial<typeof config.notification>): void {
  Object.assign(config.notification, overrides);
}

// Reset cfg and mocks before every test.
beforeEach(() => {
  jest.clearAllMocks();
  setNotificationCfg({
    smsProvider: "log",
    twilioAccountSid: undefined,
    twilioAuthToken: undefined,
    twilioFromNumber: undefined,
    africasTalkingApiKey: undefined,
    africasTalkingUsername: undefined,
  });
});

// Lazily import sendSms after mocks are set up.
const getSendSms = (): typeof import("../src/services/notification/notificationService").sendSms =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("../src/services/notification/notificationService").sendSms;

// ── log provider ────────────────────────────────────────────────────────────

describe("sendSms — log provider", () => {
  it("logs and returns without calling axios", async () => {
    setNotificationCfg({ smsProvider: "log" });
    const sendSms = getSendSms();

    await expect(sendSms("+1234567890", "Hello")).resolves.toBeUndefined();

    expect(mockAxiosPost).not.toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      "NotificationService (SMS log)",
      expect.any(Object),
    );
  });
});

// ── twilio provider ──────────────────────────────────────────────────────────

describe("sendSms — twilio provider", () => {
  it("posts to Twilio with Basic auth and URL-encoded form body", async () => {
    setNotificationCfg({
      smsProvider: "twilio",
      twilioAccountSid: "ACtest",
      twilioAuthToken: "authtoken",
      twilioFromNumber: "+15550000000",
    });
    mockAxiosPost.mockResolvedValue({ status: 201, data: { sid: "SM123" } });

    const sendSms = getSendSms();
    await expect(sendSms("+1234567890", "Test message")).resolves.toBeUndefined();

    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    const [url, body, opts] = mockAxiosPost.mock.calls[0];
    expect(url).toContain("ACtest/Messages.json");
    expect(body.toString()).toContain("To=%2B1234567890");
    expect(body.toString()).toContain("Body=Test+message");
    expect(opts.headers.Authorization).toMatch(/^Basic /);
    expect(mockLoggerInfo).toHaveBeenCalledWith("SMS sent via Twilio", expect.any(Object));
  });

  it("rethrows on Twilio HTTP error", async () => {
    setNotificationCfg({
      smsProvider: "twilio",
      twilioAccountSid: "ACtest",
      twilioAuthToken: "authtoken",
      twilioFromNumber: "+15550000000",
    });
    const networkError = new Error("Request failed with status code 401");
    mockAxiosPost.mockRejectedValue(networkError);

    const sendSms = getSendSms();
    await expect(sendSms("+1234567890", "Test")).rejects.toThrow("Request failed");
    expect(mockLoggerError).toHaveBeenCalledWith("Twilio send failed", expect.any(Object));
  });

  it("falls through to log when Twilio credentials are incomplete", async () => {
    setNotificationCfg({
      smsProvider: "twilio",
      twilioAccountSid: "ACtest",
      // intentionally missing twilioAuthToken and twilioFromNumber
    });

    const sendSms = getSendSms();
    await expect(sendSms("+1234567890", "Test")).resolves.toBeUndefined();
    expect(mockAxiosPost).not.toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalled();
  });
});

// ── africas_talking provider ─────────────────────────────────────────────────

describe("sendSms — africas_talking provider", () => {
  it("posts to AfricasTalking REST API with apiKey header and form body", async () => {
    setNotificationCfg({
      smsProvider: "africas_talking",
      africasTalkingApiKey: "testapikey",
      africasTalkingUsername: "sandbox",
    });
    mockAxiosPost.mockResolvedValue({ status: 201, data: { SMSMessageData: { Recipients: [] } } });

    const sendSms = getSendSms();
    await expect(sendSms("+254712345678", "Your OTP is 999")).resolves.toBeUndefined();

    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    const [url, body, opts] = mockAxiosPost.mock.calls[0];
    expect(url).toBe("https://api.africastalking.com/version1/messaging");
    expect(body.toString()).toContain("username=sandbox");
    expect(body.toString()).toContain("to=%2B254712345678");
    expect(body.toString()).toContain("message=Your+OTP+is+999");
    expect(opts.headers.apiKey).toBe("testapikey");
    expect(opts.headers.Accept).toBe("application/json");
    expect(opts.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      "SMS sent via AfricasTalking",
      expect.objectContaining({ to: "***" }),
    );
  });

  it("rethrows on AfricasTalking HTTP error", async () => {
    setNotificationCfg({
      smsProvider: "africas_talking",
      africasTalkingApiKey: "testapikey",
      africasTalkingUsername: "sandbox",
    });
    const apiError = new Error("Request failed with status code 403");
    mockAxiosPost.mockRejectedValue(apiError);

    const sendSms = getSendSms();
    await expect(sendSms("+254712345678", "Test")).rejects.toThrow("Request failed");
    expect(mockLoggerError).toHaveBeenCalledWith(
      "AfricasTalking send failed",
      expect.any(Object),
    );
  });

  it("throws a descriptive error and does NOT call axios when API key is missing", async () => {
    setNotificationCfg({
      smsProvider: "africas_talking",
      africasTalkingApiKey: undefined,
      africasTalkingUsername: "sandbox",
    });

    const sendSms = getSendSms();
    await expect(sendSms("+254712345678", "Hello")).rejects.toThrow(
      /AfricasTalking.*misconfiguration|AFRICAS_TALKING_API_KEY/i,
    );
    expect(mockAxiosPost).not.toHaveBeenCalled();
    expect(mockLoggerError).toHaveBeenCalled();
  });

  it("throws a descriptive error and does NOT call axios when username is missing", async () => {
    setNotificationCfg({
      smsProvider: "africas_talking",
      africasTalkingApiKey: "testapikey",
      africasTalkingUsername: undefined,
    });

    const sendSms = getSendSms();
    await expect(sendSms("+254712345678", "Hello")).rejects.toThrow(
      /AfricasTalking.*misconfiguration|AFRICAS_TALKING_USERNAME/i,
    );
    expect(mockAxiosPost).not.toHaveBeenCalled();
    expect(mockLoggerError).toHaveBeenCalled();
  });
});
