const mockTransactionFindUnique = jest.fn();
const mockEndpointFindMany = jest.fn();
const mockWebhookCreate = jest.fn();
const mockWebhookFindUnique = jest.fn();
const mockWebhookUpdate = jest.fn();
const mockSendToQueue = jest.fn();
const mockAssertQueue = jest.fn();
const mockPost = jest.fn();

jest.mock("../../config/database", () => ({
  prisma: {
    transaction: { findUnique: mockTransactionFindUnique },
    webhookEndpoint: { findMany: mockEndpointFindMany },
    webhook: {
      create: mockWebhookCreate,
      findUnique: mockWebhookFindUnique,
      update: mockWebhookUpdate,
    },
  },
}));

jest.mock("../../config/env", () => ({
  config: { webhook: { url: "https://global.example/webhook", secret: "global-secret" } },
}));

jest.mock("../../config/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

jest.mock("../../config/rabbitmq", () => ({
  QUEUES: { WEBHOOKS: "webhooks" },
  connectRabbitMQ: jest.fn().mockResolvedValue({
    assertQueue: mockAssertQueue,
    sendToQueue: mockSendToQueue,
  }),
}));

jest.mock("axios", () => ({ post: mockPost }));

import crypto from "crypto";
import { prisma } from "../../config/database";
import { enqueueWebhook, deliverWebhook } from "./webhookService";

const payloadData = { transaction_id: "transaction-1" };

function signature(payload: object, secret: string): string {
  return crypto.createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");
}

describe("webhookService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAssertQueue.mockResolvedValue(undefined);
    mockWebhookCreate
      .mockResolvedValueOnce({ id: "webhook-1" })
      .mockResolvedValueOnce({ id: "webhook-2" });
    mockWebhookUpdate.mockResolvedValue(undefined);
    mockPost.mockResolvedValue({ status: 200 });
  });

  it("enqueues one independent delivery for every active organization endpoint", async () => {
    mockTransactionFindUnique.mockResolvedValue({ organizationId: "org-1" });
    mockEndpointFindMany.mockResolvedValue([
      { id: "endpoint-1", url: "https://partner-one.example/events", secret: "secret-one" },
      { id: "endpoint-2", url: "https://partner-two.example/events", secret: "secret-two" },
    ]);

    const firstId = await enqueueWebhook("transaction.completed", payloadData, "transaction-1");

    expect(firstId).toBe("webhook-1");
    expect(prisma.webhook.create).toHaveBeenCalledTimes(2);
    expect(prisma.webhook.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          endpointId: "endpoint-1",
          endpointUrl: "https://partner-one.example/events",
          endpointSecret: "secret-one",
          signature: expect.any(String),
        }),
      }),
    );
    expect(prisma.webhook.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          endpointId: "endpoint-2",
          endpointUrl: "https://partner-two.example/events",
          endpointSecret: "secret-two",
        }),
      }),
    );
    expect(mockSendToQueue).toHaveBeenCalledTimes(2);
  });

  it("delivers to the endpoint snapshot instead of the global URL", async () => {
    const payload = {
      event: "transaction.completed",
      timestamp: "2026-09-24T00:00:00.000Z",
      data: payloadData,
    };
    mockWebhookFindUnique.mockResolvedValue({
      id: "webhook-1",
      status: "pending",
      attempts: 0,
      payload,
      signature: signature(payload, "endpoint-secret"),
      endpointUrl: "https://registered.example/events",
      endpointSecret: "endpoint-secret",
    });

    await expect(deliverWebhook("webhook-1")).resolves.toEqual({
      success: true,
      terminal: false,
    });

    expect(mockPost).toHaveBeenCalledWith(
      "https://registered.example/events",
      payload,
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-acbu-signature": signature(payload, "endpoint-secret"),
        }),
      }),
    );
    expect(prisma.webhook.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completed", attempts: 1 }),
      }),
    );
  });
});
