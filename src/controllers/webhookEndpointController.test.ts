const mockEndpointCreate = jest.fn();
const mockEndpointFindMany = jest.fn();
const mockEndpointDeleteMany = jest.fn();

jest.mock("../config/database", () => ({
  prisma: {
    webhookEndpoint: {
      create: mockEndpointCreate,
      findMany: mockEndpointFindMany,
      deleteMany: mockEndpointDeleteMany,
    },
  },
}));

jest.mock("../middleware/errorHandler", () => ({
  AppError: class AppError extends Error {
    statusCode: number;

    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { createWebhookEndpoint, deleteWebhookEndpoint } from "./webhookEndpointController";

function makeResponse(): Response {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  return response as unknown as Response;
}

function makeRequest(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    body: { url: "https://partner.example/events", secret: "endpoint-secret" },
    params: { id: "endpoint-1" },
    apiKey: { organizationId: "org-1" } as AuthRequest["apiKey"],
    ...overrides,
  } as AuthRequest;
}

describe("webhookEndpointController", () => {
  beforeEach(() => jest.clearAllMocks());

  it("creates an endpoint for the authenticated organization", async () => {
    const response = makeResponse();
    const endpoint = { id: "endpoint-1", url: "https://partner.example/events", active: true };
    mockEndpointCreate.mockResolvedValue(endpoint);

    await createWebhookEndpoint(makeRequest(), response, jest.fn());

    expect(mockEndpointCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          url: "https://partner.example/events",
          secret: "endpoint-secret",
          organizationId: "org-1",
        },
      }),
    );
    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith(endpoint);
  });

  it("scopes endpoint deletion to the authenticated organization", async () => {
    const response = makeResponse();
    mockEndpointDeleteMany.mockResolvedValue({ count: 1 });

    await deleteWebhookEndpoint(makeRequest(), response, jest.fn());

    expect(mockEndpointDeleteMany).toHaveBeenCalledWith({
      where: { id: "endpoint-1", organizationId: "org-1" },
    });
    expect(response.status).toHaveBeenCalledWith(204);
  });
});
