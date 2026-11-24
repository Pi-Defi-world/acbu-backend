import axios from "axios";
import { sendEmail } from "./notificationService";

jest.mock("axios");
jest.mock("../../config/env", () => ({
  config: {
    notification: {
      emailProvider: "sendgrid",
      emailFrom: "noreply@acbu.io",
      sendgridApiKey: "test-key",
    },
  },
}));
jest.mock("../../config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

function sendGridToField(): { email: string }[] {
  const payload = mockedAxios.post.mock.calls[0][1] as {
    personalizations: { to: { email: string }[] }[];
  };
  return payload.personalizations[0].to;
}

describe("sendEmail (SendGrid provider)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.post.mockResolvedValue({ status: 202, data: {} });
  });

  it("sends a single recipient as one personalization entry", async () => {
    await sendEmail("ops@example.com", "Subject", "Body");
    expect(sendGridToField()).toEqual([{ email: "ops@example.com" }]);
  });

  it("splits a comma-separated `to` into one entry per recipient, not one malformed address", async () => {
    // This is the actual shape weightDriftAuditJob.ts sends: multiple admin
    // recipients joined with a comma via parseAlertRecipients().join(",").
    // Before this fix, the whole joined string was sent as a single `email`
    // field, which SendGrid does not treat as a multi-recipient address.
    await sendEmail("ops@example.com,admin@example.com", "Subject", "Body");
    expect(sendGridToField()).toEqual([
      { email: "ops@example.com" },
      { email: "admin@example.com" },
    ]);
  });

  it("trims whitespace around comma-separated addresses", async () => {
    await sendEmail("ops@example.com, admin@example.com", "Subject", "Body");
    expect(sendGridToField()).toEqual([
      { email: "ops@example.com" },
      { email: "admin@example.com" },
    ]);
  });

  it("ignores empty segments from stray or trailing commas", async () => {
    await sendEmail("ops@example.com,,admin@example.com,", "Subject", "Body");
    expect(sendGridToField()).toEqual([
      { email: "ops@example.com" },
      { email: "admin@example.com" },
    ]);
  });

  it("propagates an error instead of swallowing it", async () => {
    mockedAxios.post.mockRejectedValue(new Error("SendGrid down"));

    await expect(sendEmail("ops@example.com", "Subject", "Body")).rejects.toThrow(
      "SendGrid down",
    );
  });
});
