const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
const mockAxiosPost = jest.fn();
const mockConfig = {
  webhook: {
    url: "https://example.com/webhook",
    secret: "test-secret",
  },
};

jest.mock("../../config/database", () => ({
  prisma: {
    webhook: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}));

jest.mock("../../config/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../../config/env", () => ({
  config: mockConfig,
}));

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    post: mockAxiosPost,
  },
}));

import { deliverWebhook, getRetryPolicyForUrl } from "./webhookService";

describe("getRetryPolicyForUrl", () => {
  it("uses a different backoff profile for partner endpoints", () => {
    expect(getRetryPolicyForUrl("https://example.com/webhook")).toMatchObject({
      maxAttempts: 5,
      initialDelayMs: 1000,
    });

    expect(getRetryPolicyForUrl("https://api.partner.example.com/webhook")).toMatchObject({
      maxAttempts: 8,
      initialDelayMs: 2500,
    });
  });
});

describe("deliverWebhook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockConfig.webhook.url = "https://api.partner.example.com/webhook";
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("retries failed deliveries using the endpoint backoff schedule before succeeding", async () => {
    const webhookRecord = {
      id: "webhook-1",
      status: "pending",
      attempts: 0,
      payload: { hello: "world" },
      signature: "sig",
      lastAttemptAt: null,
    };

    mockFindUnique.mockResolvedValue(webhookRecord);
    mockUpdate.mockImplementation(async (_args) => ({
      ...webhookRecord,
      ..._args.data,
    }));
    mockAxiosPost
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce({ status: 200 });

    const setTimeoutSpy = jest.spyOn(global, "setTimeout");

    const resultPromise = deliverWebhook("webhook-1");
    await jest.advanceTimersByTimeAsync(2500);

    await expect(resultPromise).resolves.toEqual({ success: true, terminal: false });
    expect(mockAxiosPost).toHaveBeenCalledTimes(2);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2500);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "webhook-1" },
      }),
    );
  });
});
