/**
 * AB-029 (#979): the notification consumer must get its payload types from the
 * queue schema registry instead of asserting them, and malformed payloads must
 * fail loudly (logged + dead-lettered) rather than being cast through.
 *
 * These tests drive the real exported `startNotificationConsumer()` against a
 * fake RabbitMQ channel: message envelopes go in, and the assertions are about
 * what the consumer really sends (email/SMS) and really dead-letters.
 */
import type { ConsumeMessage } from "amqplib";
import { v4 as uuidv4 } from "uuid";

// uuid v14 ships as ESM only, which Jest's CommonJS runtime cannot require
// (SyntaxError: Unexpected token 'export'). The consumer only needs a v4-shaped
// envelope id, so swap in a fixed, schema-valid one.
jest.mock("uuid", () => ({
  v4: () => "11111111-2222-4333-8444-555555555555",
}));

const fakeChannel = {
  prefetch: jest.fn(),
  consume: jest.fn(),
  ack: jest.fn(),
  nack: jest.fn(),
  sendToQueue: jest.fn(),
  assertQueue: jest.fn().mockResolvedValue({ queue: "q" }),
};

jest.mock("../src/config/rabbitmq", () => {
  const actual = jest.requireActual("../src/config/rabbitmq");
  return {
    ...actual,
    connectRabbitMQ: jest.fn(async () => fakeChannel),
    assertQueueWithDLQ: jest.fn(async () => ({ queue: "q" })),
    getRabbitMQChannel: () => fakeChannel,
  };
});

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

jest.mock("../src/services/notification", () => ({
  sendEmail: jest.fn(),
  sendEmailBatch: jest.fn(),
  sendSms: jest.fn(),
  renderOtpTemplate: jest.fn(() => "<otp body>"),
  renderWithdrawalStatusTemplate: jest.fn(() => "<withdrawal body>"),
  renderReserveAlertTemplate: jest.fn(() => "<reserve body>"),
  renderInvestmentWithdrawalReadyTemplate: jest.fn(() => "<investment body>"),
}));

import { QUEUES } from "../src/config/rabbitmq";
import { logger } from "../src/config/logger";
import { prisma } from "../src/config/database";
import {
  sendEmail,
  sendEmailBatch,
  sendSms,
  renderInvestmentWithdrawalReadyTemplate,
} from "../src/services/notification";
import { startNotificationConsumer } from "../src/jobs/notificationConsumer";

const mockSendEmail = sendEmail as jest.Mock;
const mockSendEmailBatch = sendEmailBatch as jest.Mock;
const mockSendSms = sendSms as jest.Mock;
const mockRenderInvestment = renderInvestmentWithdrawalReadyTemplate as jest.Mock;
const mockFindUnique = prisma.user.findUnique as jest.Mock;
const mockFindMany = prisma.user.findMany as jest.Mock;
const mockLoggerError = logger.error as jest.Mock;

const handlers: Record<string, (msg: ConsumeMessage | null) => Promise<void>> = {};

/** Build a schema-shaped message envelope for a queue. */
function makeMessage(
  queue: string,
  payload: unknown,
  envelopeOverrides: Record<string, unknown> = {},
): ConsumeMessage {
  const envelope = {
    version: 1,
    type: queue,
    messageId: uuidv4(),
    timestamp: new Date().toISOString(),
    payload,
    ...envelopeOverrides,
  };
  return {
    content: Buffer.from(JSON.stringify(envelope)),
    properties: { headers: {} },
  } as unknown as ConsumeMessage;
}

/** Raw (non-envelope) body, used to exercise the JSON/envelope guards. */
function makeRawMessage(body: unknown): ConsumeMessage {
  return {
    content: Buffer.from(JSON.stringify(body)),
    properties: { headers: {} },
  } as unknown as ConsumeMessage;
}

function expectDeadLettered(queueName: string, reasonFragment: string): void {
  expect(fakeChannel.sendToQueue).toHaveBeenCalledWith(
    `${queueName}_dlq`,
    expect.any(Buffer),
    expect.objectContaining({
      headers: expect.objectContaining({
        "x-dead-letter-reason": expect.stringContaining(reasonFragment),
      }),
    }),
  );
}

beforeAll(async () => {
  fakeChannel.consume.mockImplementation(
    (queue: string, cb: (msg: ConsumeMessage | null) => Promise<void>) => {
      handlers[queue] = cb;
      return Promise.resolve({ consumerTag: `tag-${queue}` });
    },
  );
  await startNotificationConsumer();
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NOTIFICATION_ALERT_EMAIL = "ops@example.com";
  mockFindUnique.mockResolvedValue(null);
  mockFindMany.mockResolvedValue([]);
});

describe("notification consumer payload typing and validation", () => {
  it("registers a consumer for the OTP_SEND and NOTIFICATIONS queues", () => {
    expect(Object.keys(handlers).sort()).toEqual([QUEUES.NOTIFICATIONS, QUEUES.OTP_SEND].sort());
  });

  it("handles a schema-valid reserve_alert end to end", async () => {
    await handlers[QUEUES.NOTIFICATIONS](
      makeMessage(QUEUES.NOTIFICATIONS, {
        type: "reserve_alert",
        health: "warning",
        overcollateralizationRatio: 0.98,
      }),
    );

    expect(mockSendEmail).toHaveBeenCalledWith(
      "ops@example.com",
      "ACBU Reserve Alert",
      "<reserve body>",
    );
    expect(fakeChannel.ack).toHaveBeenCalledTimes(1);
    expect(fakeChannel.sendToQueue).not.toHaveBeenCalled();
  });

  it("rejects a typed-wrong reserve_alert payload to the DLQ instead of sending", async () => {
    await handlers[QUEUES.NOTIFICATIONS](
      makeMessage(QUEUES.NOTIFICATIONS, {
        type: "reserve_alert",
        health: "warning",
        // A string here used to be cast through; the schema rejects it.
        overcollateralizationRatio: "not-a-number",
      }),
    );

    expect(mockSendEmail).not.toHaveBeenCalled();
    expectDeadLettered(QUEUES.NOTIFICATIONS, "Validation failed");
    expect(mockLoggerError).toHaveBeenCalledWith(
      "NOTIFICATIONS validation failed, sending to DLQ",
      expect.objectContaining({ errors: expect.any(Array) }),
    );
    expect(fakeChannel.ack).toHaveBeenCalledTimes(1);
  });

  it("dead-letters a message whose envelope is malformed", async () => {
    await handlers[QUEUES.NOTIFICATIONS](
      makeRawMessage({ version: 1, type: QUEUES.NOTIFICATIONS, payload: {} }), // no messageId/timestamp
    );

    expect(mockSendEmail).not.toHaveBeenCalled();
    expectDeadLettered(QUEUES.NOTIFICATIONS, "Validation failed");
    expect(mockLoggerError).toHaveBeenCalledWith(
      "Invalid message envelope",
      expect.objectContaining({ queue: QUEUES.NOTIFICATIONS }),
    );
  });

  it("routes a withdrawal_status notification to the user's email and SMS channels", async () => {
    mockFindUnique.mockResolvedValue({ email: "user@example.com", phoneE164: "+15550001" });

    await handlers[QUEUES.NOTIFICATIONS](
      makeMessage(QUEUES.NOTIFICATIONS, {
        type: "withdrawal_status",
        userId: "user-1",
        status: "processing",
        currency: "NGN",
        amount: 1500.5,
        channel: ["email", "sms"],
      }),
    );

    expect(mockSendEmail).toHaveBeenCalledWith(
      "user@example.com",
      "ACBU Withdrawal Update",
      "<withdrawal body>",
    );
    expect(mockSendSms).toHaveBeenCalledWith("+15550001", "<withdrawal body>");
  });

  it("feeds schema-coerced values (not raw JSON) into the investment template", async () => {
    mockFindMany.mockResolvedValue([
      { email: "a@org.com", phoneE164: null },
      { email: null, phoneE164: null },
    ]);

    await handlers[QUEUES.NOTIFICATIONS](
      makeMessage(QUEUES.NOTIFICATIONS, {
        type: "investment_withdrawal_ready",
        organizationId: "org-1",
        amountAcbu: "250.75", // coerced by the schema, never cast from `any`
      }),
    );

    // The template receives the coerced number, not the raw string.
    expect(mockRenderInvestment).toHaveBeenCalledWith(250.75);
    // Only the member with an email address is batched.
    expect(mockSendEmailBatch).toHaveBeenCalledWith([
      {
        to: "a@org.com",
        subject: "Organization investment withdrawal is ready",
        body: "<investment body>",
      },
    ]);
  });

  it("dead-letters an unknown notification type rather than silently dropping it", async () => {
    await handlers[QUEUES.NOTIFICATIONS](
      makeMessage(QUEUES.NOTIFICATIONS, { type: "not_a_real_type" }),
    );

    expect(mockSendEmail).not.toHaveBeenCalled();
    expectDeadLettered(QUEUES.NOTIFICATIONS, "Validation failed");
  });

  it("sends a schema-valid OTP and dead-letters an invalid one", async () => {
    await handlers[QUEUES.OTP_SEND](
      makeMessage(QUEUES.OTP_SEND, { channel: "email", to: "user@example.com", code: "123456" }),
    );
    expect(mockSendEmail).toHaveBeenCalledWith(
      "user@example.com",
      "Your ACBU verification code",
      "<otp body>",
    );

    mockSendEmail.mockClear();
    await handlers[QUEUES.OTP_SEND](
      makeMessage(QUEUES.OTP_SEND, { channel: "carrier-pigeon", to: "user@example.com", code: "1" }),
    );
    expect(mockSendEmail).not.toHaveBeenCalled();
    expectDeadLettered(QUEUES.OTP_SEND, "Validation failed");
  });

  it("retries a transient failure by re-queueing with an incremented x-retries header", async () => {
    mockSendEmail.mockRejectedValueOnce(new Error("smtp down"));

    await handlers[QUEUES.NOTIFICATIONS](
      makeMessage(QUEUES.NOTIFICATIONS, {
        type: "reserve_alert",
        health: "critical",
        overcollateralizationRatio: 0.5,
      }),
    );

    expect(fakeChannel.sendToQueue).toHaveBeenCalledWith(
      QUEUES.NOTIFICATIONS,
      expect.any(Buffer),
      expect.objectContaining({ headers: { "x-retries": 1 } }),
    );
    // Re-queue is a retry, not a dead letter.
    expect(fakeChannel.sendToQueue).not.toHaveBeenCalledWith(
      `${QUEUES.NOTIFICATIONS}_dlq`,
      expect.anything(),
      expect.anything(),
    );
  });

  it("nacks permanently once the retry budget is exhausted", async () => {
    const msg = makeMessage(QUEUES.NOTIFICATIONS, {
      type: "reserve_alert",
      health: "critical",
      overcollateralizationRatio: 0.5,
    });
    msg.properties.headers = { "x-retries": 99 };
    mockSendEmail.mockRejectedValueOnce(new Error("smtp down"));

    await handlers[QUEUES.NOTIFICATIONS](msg);

    expect(fakeChannel.nack).toHaveBeenCalledWith(msg, false, false);
  });
});
