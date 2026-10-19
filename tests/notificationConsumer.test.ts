/**
 * Tests the notification consumer through its real implementation.
 *
 * `processNotification` / `processOtpSend` are imported from
 * `src/jobs/notificationConsumer.ts` rather than duplicated here, and payloads
 * are typed by the queue schemas, so a change to either the consumer or the
 * schema is caught instead of being shadowed by a copy of the logic.
 *
 * Messages are handed to the same `parseQueueMessage` the consumer uses, as
 * raw bytes on the wire, so a malformed queue payload is rejected with the
 * field-level context it is rejected with in production.
 */
jest.mock("../src/config/logger", () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock("../src/config/database", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock("../src/config/rabbitmq", () => {
  // The queue names are the keys of the payload-schema map, so they have to be
  // the real ones. The connection helpers are never reached by these tests.
  const actual =
    jest.requireActual<typeof import("../src/config/rabbitmq")>("../src/config/rabbitmq");
  return {
    QUEUES: actual.QUEUES,
    EXCHANGES: actual.EXCHANGES,
    connectRabbitMQ: jest.fn(),
    assertQueueWithDLQ: jest.fn(),
    getRabbitMQChannel: jest.fn(),
  };
});

jest.mock("../src/services/notification", () => ({
  sendEmail: jest.fn(),
  sendEmailBatch: jest.fn(),
  sendSms: jest.fn(),
  renderOtpTemplate: jest.fn(),
  renderWithdrawalStatusTemplate: jest.fn(),
  renderReserveAlertTemplate: jest.fn(),
  renderInvestmentWithdrawalReadyTemplate: jest.fn(),
}));

import { prisma } from "../src/config/database";
import { QUEUES } from "../src/config/rabbitmq";
import {
  sendEmail,
  sendEmailBatch,
  sendSms,
  renderOtpTemplate,
  renderWithdrawalStatusTemplate,
  renderReserveAlertTemplate,
  renderInvestmentWithdrawalReadyTemplate,
} from "../src/services/notification";
import { processNotification, processOtpSend } from "../src/jobs/notificationConsumer";
import { MessageValidationError, parseQueueMessage } from "../src/utils/rabbitmq-validation";
import type { Notification, OtpSend } from "../src/types/rabbitmq-schemas";

const mockSendEmail = sendEmail as jest.Mock;
const mockSendEmailBatch = sendEmailBatch as jest.Mock;
const mockSendSms = sendSms as jest.Mock;
const mockRenderOtp = renderOtpTemplate as jest.Mock;
const mockRenderWithdrawalStatus = renderWithdrawalStatusTemplate as jest.Mock;
const mockRenderReserveAlert = renderReserveAlertTemplate as jest.Mock;
const mockRenderInvestmentReady = renderInvestmentWithdrawalReadyTemplate as jest.Mock;
const mockFindUnique = prisma.user.findUnique as jest.Mock;
const mockFindMany = prisma.user.findMany as jest.Mock;

/** A syntactically valid envelope message id (`MessageEnvelopeSchema`). */
const MESSAGE_ID = "123e4567-e89b-12d3-a456-426614174000";

/** Wrap a payload in the envelope producers send, as bytes on the wire. */
function envelope(payload: unknown): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      type: "notifications",
      messageId: MESSAGE_ID,
      timestamp: new Date().toISOString(),
      payload,
    }),
  );
}

/** The consumer's own validation entry point for the NOTIFICATIONS queue. */
function receiveNotification(content: Buffer): Notification {
  return parseQueueMessage(QUEUES.NOTIFICATIONS, content);
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.NOTIFICATION_ALERT_EMAIL;
  mockRenderOtp.mockReturnValue("<p>otp</p>");
  mockRenderWithdrawalStatus.mockReturnValue("<p>withdrawal</p>");
  mockRenderReserveAlert.mockReturnValue("<p>reserve</p>");
  mockRenderInvestmentReady.mockReturnValue("<p>investment ready</p>");
});

describe("notification consumer — payload validation", () => {
  it("returns the payload typed by the queue it was received from", () => {
    const received = receiveNotification(
      envelope({
        type: "withdrawal_status",
        userId: "user-1",
        status: "completed",
        currency: "USD",
        amount: 10,
        channel: ["email"],
      }),
    );

    // The queue, not a caller-supplied type argument, decided this is a
    // `Notification`; narrowing on `type` is what the consumer does.
    expect(received.type).toBe("withdrawal_status");
    if (received.type !== "withdrawal_status") throw new Error("unreachable");
    expect(received.amount).toBe(10);
  });

  it("coerces a numeric field sent as a string, and rejects a non-numeric one", () => {
    const coerced = receiveNotification(
      envelope({ type: "investment_withdrawal_ready", userId: "user-1", amountAcbu: "100" }),
    );
    expect(coerced.type).toBe("investment_withdrawal_ready");
    if (coerced.type !== "investment_withdrawal_ready") throw new Error("unreachable");
    expect(coerced.amountAcbu).toBe(100);

    expect(() =>
      receiveNotification(envelope({ type: "investment_withdrawal_ready", amountAcbu: "nope" })),
    ).toThrow(MessageValidationError);
  });

  it("rejects a payload missing required fields, naming them", () => {
    let caught: unknown;
    try {
      receiveNotification(envelope({ type: "withdrawal_status" }));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MessageValidationError);
    if (!(caught instanceof MessageValidationError)) throw new Error("unreachable");
    expect(caught.queue).toBe(QUEUES.NOTIFICATIONS);
    expect(caught.validationErrors.length).toBeGreaterThan(0);
    expect(JSON.stringify(caught.validationErrors)).toContain("status");
  });

  it("rejects a message that is not an envelope at all", () => {
    let caught: unknown;
    try {
      receiveNotification(Buffer.from(JSON.stringify({ type: "reserve_alert", health: "ok" })));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MessageValidationError);
    if (!(caught instanceof MessageValidationError)) throw new Error("unreachable");
    expect(caught.queue).toBe(QUEUES.NOTIFICATIONS);
    expect(JSON.stringify(caught.validationErrors)).toContain("messageId");
  });

  it("rejects payloads of another queue rather than passing them through", () => {
    // An OTP payload delivered on the notifications queue has no `type`, so the
    // notifications schema rejects it instead of the consumer misreading it.
    expect(() =>
      receiveNotification(envelope({ channel: "email", to: "a@b.c", code: "1234" })),
    ).toThrow(MessageValidationError);
  });

  it("rejects an OTP payload whose channel the schema does not define", () => {
    expect(() =>
      parseQueueMessage(QUEUES.OTP_SEND, envelope({ channel: "push", to: "a@b.c", code: "1234" })),
    ).toThrow(MessageValidationError);
  });
});

describe("notification consumer — notifications", () => {
  it("emails and texts the user for a withdrawal status", async () => {
    mockFindUnique.mockResolvedValue({ email: "user@example.com", phoneE164: "+1234567890" });

    await processNotification(
      receiveNotification(
        envelope({
          type: "withdrawal_status",
          userId: "user-1",
          status: "completed",
          currency: "USD",
          amount: 10,
          channel: ["email", "sms"],
        }),
      ),
    );

    expect(mockRenderWithdrawalStatus).toHaveBeenCalledWith("completed", "USD", 10);
    expect(mockSendEmail).toHaveBeenCalledWith(
      "user@example.com",
      "ACBU Withdrawal Update",
      "<p>withdrawal</p>",
    );
    expect(mockSendSms).toHaveBeenCalledWith("+1234567890", "<p>withdrawal</p>");
  });

  it("honours the requested channels for a withdrawal status", async () => {
    mockFindUnique.mockResolvedValue({ email: "user@example.com", phoneE164: "+1234567890" });

    await processNotification(
      receiveNotification(
        envelope({
          type: "withdrawal_status",
          userId: "user-1",
          status: "pending",
          currency: "EUR",
          amount: 5,
          channel: ["sms"],
        }),
      ),
    );

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSendSms).toHaveBeenCalledWith("+1234567890", "<p>withdrawal</p>");
  });

  it("sends the reserve alert to the configured admin address", async () => {
    process.env.NOTIFICATION_ALERT_EMAIL = "admin@example.com";

    await processNotification(
      receiveNotification(
        envelope({ type: "reserve_alert", health: "warning", overcollateralizationRatio: 1.2 }),
      ),
    );

    expect(mockRenderReserveAlert).toHaveBeenCalledWith("warning", 1.2);
    expect(mockSendEmail).toHaveBeenCalledWith(
      "admin@example.com",
      "ACBU Reserve Alert",
      "<p>reserve</p>",
    );
  });

  it("does not send a reserve alert when no admin address is configured", async () => {
    await processNotification(
      receiveNotification(
        envelope({ type: "reserve_alert", health: "warning", overcollateralizationRatio: 1.2 }),
      ),
    );

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("emails the user and texts every org member for an org withdrawal", async () => {
    mockFindUnique.mockResolvedValue({ email: "user@example.com", phoneE164: null });
    mockFindMany.mockResolvedValue([
      { email: "admin1@org.com", phoneE164: "+1111111111" },
      { email: "admin2@org.com", phoneE164: null },
      { email: null, phoneE164: "+2222222222" },
    ]);

    await processNotification(
      receiveNotification(
        envelope({
          type: "investment_withdrawal_ready",
          userId: "user-1",
          organizationId: "org-1",
          amountAcbu: 100,
        }),
      ),
    );

    expect(mockSendEmail).toHaveBeenCalledWith(
      "user@example.com",
      "Your investment withdrawal is ready",
      "<p>investment ready</p>",
    );
    // Members without an address are filtered out of the batch, not sent to.
    expect(mockSendEmailBatch).toHaveBeenCalledWith([
      {
        to: "admin1@org.com",
        subject: "Organization investment withdrawal is ready",
        body: "<p>investment ready</p>",
      },
      {
        to: "admin2@org.com",
        subject: "Organization investment withdrawal is ready",
        body: "<p>investment ready</p>",
      },
    ]);
    expect(mockSendSms).toHaveBeenCalledWith("+1111111111", "<p>investment ready</p>");
    expect(mockSendSms).toHaveBeenCalledWith("+2222222222", "<p>investment ready</p>");
    expect(mockSendSms).toHaveBeenCalledTimes(2);
  });

  it("sends nothing when an org withdrawal has no members", async () => {
    mockFindMany.mockResolvedValue([]);

    await processNotification(
      receiveNotification(
        envelope({
          type: "investment_withdrawal_ready",
          organizationId: "org-empty",
          amountAcbu: 100,
        }),
      ),
    );

    expect(mockSendEmailBatch).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
  });
});

describe("notification consumer — OTP", () => {
  it("renders and emails a code for an email OTP", async () => {
    const payload: OtpSend = { channel: "email", to: "user@example.com", code: "123456" };

    await processOtpSend(parseQueueMessage(QUEUES.OTP_SEND, envelope(payload)));

    expect(mockRenderOtp).toHaveBeenCalledWith("123456");
    expect(mockSendEmail).toHaveBeenCalledWith(
      "user@example.com",
      "Your ACBU verification code",
      "<p>otp</p>",
    );
  });

  it("texts a code for an SMS OTP", async () => {
    const payload: OtpSend = { channel: "sms", to: "+1234567890", code: "123456" };

    await processOtpSend(parseQueueMessage(QUEUES.OTP_SEND, envelope(payload)));

    expect(mockSendSms).toHaveBeenCalledWith("+1234567890", "<p>otp</p>");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("rejects a channel the schema does not define instead of reaching the consumer", () => {
    // The schema only admits "email" and "sms", so an OTP for any other
    // channel is rejected at the boundary with field-level context.
    let caught: unknown;
    try {
      parseQueueMessage(QUEUES.OTP_SEND, envelope({ channel: "telepathy", to: "+1", code: "1" }));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MessageValidationError);
    if (!(caught instanceof MessageValidationError)) throw new Error("unreachable");
    expect(JSON.stringify(caught.validationErrors)).toContain("channel");
  });
});
