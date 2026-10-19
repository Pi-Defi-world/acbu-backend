/**
 * Tests for src/middleware/errorHandler.ts (AB-028 / #978)
 *
 * Security requirement: err.details must NEVER appear in the JSON sent to the
 * client, regardless of how many keys or what type the details object contains.
 * Details are only permitted in the internal server log.
 */

import { AppError, errorHandler } from "../src/middleware/errorHandler";
import { Request, Response, NextFunction } from "express";

// ─── logger mock ────────────────────────────────────────────────────────────
jest.mock("../src/config/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { logger } from "../src/config/logger";
const mockLoggerError = logger.error as jest.Mock;
const mockLoggerWarn = logger.warn as jest.Mock;

// ─── helpers ────────────────────────────────────────────────────────────────

/** Minimal Express request stub. */
function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    method: "GET",
    path: "/api/v1/test",
    ...overrides,
  } as unknown as Request;
}

/**
 * Minimal Express response stub that captures the status code and the payload
 * passed to json().
 */
function makeRes(): Response & { _status: number; _body: unknown } {
  const res = {
    _status: 0,
    _body: undefined as unknown,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: unknown) {
      this._body = body;
      return this;
    },
  };
  return res as unknown as Response & { _status: number; _body: unknown };
}

const noopNext: NextFunction = jest.fn();

// ─── AppError tests ──────────────────────────────────────────────────────────

describe("errorHandler — AppError", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the correct HTTP status code", () => {
    const res = makeRes();
    errorHandler(new AppError("Not found", 404, "NOT_FOUND"), makeReq(), res, noopNext);
    expect(res._status).toBe(404);
  });

  it("includes code, error_code, message, and statusCode in the error envelope", () => {
    const res = makeRes();
    errorHandler(new AppError("Forbidden", 403, "FORBIDDEN"), makeReq(), res, noopNext);

    expect(res._body).toEqual({
      error: {
        code: "FORBIDDEN",
        error_code: "FORBIDDEN",
        message: "Forbidden",
        statusCode: 403,
      },
    });
  });

  // ── AB-028 core requirement ─────────────────────────────────────────────
  it("does NOT expose err.details when details is an object", () => {
    const details = { field: "email", hint: "Must be a valid address", internalId: "v-42" };
    const res = makeRes();
    errorHandler(new AppError("Validation failed", 422, "VALIDATION_ERROR", details), makeReq(), res, noopNext);

    const body = res._body as { error: Record<string, unknown> };
    expect(body.error).not.toHaveProperty("details");
  });

  it("does NOT expose err.details when details is a string", () => {
    const res = makeRes();
    errorHandler(new AppError("Bad request", 400, "BAD_REQUEST", "internal hint"), makeReq(), res, noopNext);

    const body = res._body as { error: Record<string, unknown> };
    expect(body.error).not.toHaveProperty("details");
  });

  it("does NOT expose err.details when details is an array", () => {
    const res = makeRes();
    errorHandler(
      new AppError("Multi-error", 400, "VALIDATION_ERROR", [{ field: "amount" }, { field: "currency" }]),
      makeReq(),
      res,
      noopNext,
    );

    const body = res._body as { error: Record<string, unknown> };
    expect(body.error).not.toHaveProperty("details");
  });

  it("still logs details internally (summarized, not raw)", () => {
    const details = { field: "password", internalHint: "bcrypt cost too low" };
    errorHandler(
      new AppError("Validation failed", 422, "VALIDATION_ERROR", details),
      makeReq(),
      makeRes(),
      noopNext,
    );

    expect(mockLoggerError).toHaveBeenCalledWith(
      "Application error",
      expect.objectContaining({ details: expect.anything() }),
    );

    // The raw details object must NOT appear verbatim in the log call
    const logCall = mockLoggerError.mock.calls[0] as [string, Record<string, unknown>];
    const loggedDetails = logCall[1].details;
    expect(loggedDetails).not.toEqual(details);
  });

  it("response body has no extra keys beyond the documented four", () => {
    const res = makeRes();
    errorHandler(new AppError("Conflict", 409, "CONFLICT"), makeReq(), res, noopNext);

    const body = res._body as { error: Record<string, unknown> };
    const keys = Object.keys(body.error).sort();
    expect(keys).toEqual(["code", "error_code", "message", "statusCode"]);
  });

  it("works correctly when no details are provided", () => {
    const res = makeRes();
    errorHandler(new AppError("Rate limited", 429), makeReq(), res, noopNext);

    expect(res._status).toBe(429);
    const body = res._body as { error: Record<string, unknown> };
    expect(body.error).not.toHaveProperty("details");
    expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });
});

// ─── SyntaxError tests ───────────────────────────────────────────────────────

describe("errorHandler — SyntaxError (invalid JSON body)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 with INVALID_JSON code", () => {
    const err = Object.assign(new SyntaxError("Unexpected token }"), { body: true });
    const res = makeRes();
    errorHandler(err, makeReq(), res, noopNext);

    expect(res._status).toBe(400);
    const body = res._body as { error: Record<string, unknown> };
    expect(body.error.code).toBe("INVALID_JSON");
  });

  it("uses a safe, hardcoded message and does not expose raw parse details", () => {
    const err = Object.assign(new SyntaxError("Unexpected token } at position 99"), { body: true });
    const res = makeRes();
    errorHandler(err, makeReq(), res, noopNext);

    const body = res._body as { error: Record<string, unknown> };
    expect(body.error.message).toBe("Invalid JSON payload");
    // The raw SyntaxError message must NOT appear in the top-level message
    expect(body.error.message).not.toMatch(/Unexpected token/);
  });
});

// ─── Unexpected error tests ───────────────────────────────────────────────────

describe("errorHandler — unexpected errors", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 500 with INTERNAL_ERROR", () => {
    const res = makeRes();
    errorHandler(new Error("Something exploded"), makeReq(), res, noopNext);

    expect(res._status).toBe(500);
    const body = res._body as { error: Record<string, unknown> };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Internal server error");
  });

  it("does not expose raw error message to client for unexpected errors", () => {
    const res = makeRes();
    errorHandler(new Error("DB connection failed: host=db.internal pass=s3cr3t"), makeReq(), res, noopNext);

    const body = res._body as { error: Record<string, unknown> };
    expect(body.error.message).toBe("Internal server error");
    expect(body.error.message).not.toMatch(/s3cr3t/);
  });

  it("logs unexpected errors internally", () => {
    errorHandler(new Error("Internal failure"), makeReq(), makeRes(), noopNext);
    expect(mockLoggerError).toHaveBeenCalledWith("Unexpected error", expect.any(Object));
  });
});

// ─── AppError constructor tests ───────────────────────────────────────────────

describe("AppError constructor", () => {
  it("assigns statusCode, code, and details correctly", () => {
    const details = { field: "amount" };
    const err = new AppError("Bad input", 400, "BAD_REQUEST", details);

    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.details).toBe(details);
    expect(err.isOperational).toBe(true);
  });

  it("accepts codeOrDetails as the details object (3-arg form)", () => {
    const details = { field: "currency" };
    const err = new AppError("Bad input", 400, details);

    expect(err.code).toBe("BAD_REQUEST"); // fallback code for 400
    expect(err.details).toBe(details);
  });

  it("assigns fallback code RATE_LIMIT_EXCEEDED for status 429", () => {
    const err = new AppError("Too many requests", 429);
    expect(err.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("assigns fallback code INTERNAL_ERROR for status 500", () => {
    const err = new AppError("Server exploded", 500);
    expect(err.code).toBe("INTERNAL_ERROR");
  });

  it("is an instance of Error", () => {
    expect(new AppError("oops", 400)).toBeInstanceOf(Error);
  });
});
