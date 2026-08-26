/**
 * Tests for src/middleware/requestLogger.ts (#792)
 *
 * Acceptance: Requests appear in logs with correlationId.
 * The middleware must:
 *   1. Log an audit_request entry on response finish
 *   2. Include a correlationId derived from x-request-id header (or generate one)
 *   3. Propagate correlationId back via the x-request-id response header
 */

import { requestLogger } from "../src/middleware/requestLogger";
import { Request, Response, NextFunction } from "express";
import { EventEmitter } from "events";

// Mock the logger so we can capture calls without writing to disk
jest.mock("../src/config/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { logger } from "../src/config/logger";

const mockInfo = logger.info as jest.Mock;

/** Build a minimal Express-like request stub. */
function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    method: "GET",
    path: "/api/v1/users",
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    body: {},
    get: (h: string) => (h === "user-agent" ? "jest-test" : undefined),
    ...overrides,
  } as unknown as Request;
}

/** Build a minimal Express-like response stub that supports events. */
function makeRes(): Response & EventEmitter {
  const emitter = new EventEmitter();
  const res = Object.assign(emitter, {
    statusCode: 200,
    setHeader: jest.fn(),
    getHeader: jest.fn(),
  });
  return res as unknown as Response & EventEmitter;
}

describe("requestLogger middleware (#792)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("logs audit_request with correlationId after response finish", () => {
    const req = makeReq({ headers: { "x-request-id": "test-corr-id-123" } });
    const res = makeRes();
    const next: NextFunction = jest.fn();

    requestLogger(req, res, next);

    // next() must be called so the chain continues
    expect(next).toHaveBeenCalled();

    // Trigger response finish
    res.emit("finish");

    expect(mockInfo).toHaveBeenCalledWith(
      "audit_request",
      expect.objectContaining({
        correlationId: "test-corr-id-123",
        method: "GET",
        path: "/api/v1/users",
        statusCode: 200,
      }),
    );
  });

  it("generates a correlationId when x-request-id header is absent", () => {
    const req = makeReq(); // no x-request-id
    const res = makeRes();
    const next: NextFunction = jest.fn();

    requestLogger(req, res, next);
    res.emit("finish");

    expect(mockInfo).toHaveBeenCalledWith(
      "audit_request",
      expect.objectContaining({
        correlationId: expect.any(String),
      }),
    );

    const [, meta] = mockInfo.mock.calls[0] as [string, Record<string, unknown>];
    // Auto-generated correlationId must be a non-empty string (UUID format)
    expect(meta.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("propagates correlationId to response via x-request-id header", () => {
    const req = makeReq({ headers: { "x-request-id": "prop-corr-456" } });
    const res = makeRes();
    const next: NextFunction = jest.fn();

    requestLogger(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith("x-request-id", "prop-corr-456");
  });

  it("includes durationMs, statusCode, and ip in the log entry", () => {
    const req = makeReq({ ip: "10.0.0.1" });
    const res = makeRes();
    res.statusCode = 201;
    const next: NextFunction = jest.fn();

    requestLogger(req, res, next);
    res.emit("finish");

    expect(mockInfo).toHaveBeenCalledWith(
      "audit_request",
      expect.objectContaining({
        ip: "10.0.0.1",
        statusCode: 201,
        durationMs: expect.any(Number),
      }),
    );
  });
});
