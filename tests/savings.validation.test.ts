import { AppError } from "../src/middleware/errorHandler";
import { validate } from "../src/middleware/validator";
import {
  savingsDepositSchema,
  savingsPositionsSchema,
  savingsWithdrawSchema,
} from "../src/validators/savingsValidator";
import type { Request, Response, NextFunction } from "express";

describe("Savings validation", () => {
  const mockRes = {} as Response;
  const mockNext = jest.fn() as jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns structured validation errors for invalid deposit amount", () => {
    const req = {
      body: { amount: "abc", term_seconds: "777" },
      query: {},
      params: {},
    } as unknown as Request;

    try {
      validate(savingsDepositSchema)(req, mockRes, mockNext);
      throw new Error("Expected validation to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.statusCode).toBe(400);
      expect(appError.details).toEqual({
        errors: expect.arrayContaining([
          {
            path: "body.amount",
            message: "Amount must be a decimal string",
          },
          {
            path: "body.term_seconds",
            message: expect.any(String),
          },
        ]),
      });
    }
  });

  it("returns structured validation errors for unsupported term_seconds", () => {
    const req = {
      body: { amount: "10.00", term_seconds: "123" },
      query: {},
      params: {},
    } as unknown as Request;

    try {
      validate(savingsDepositSchema)(req, mockRes, mockNext);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.statusCode).toBe(400);
      expect(appError.details).toEqual({
        errors: [
          {
            path: "body.term_seconds",
            message: expect.stringContaining("term_seconds must be one of"),
          },
        ],
      });
    }
  });

  it("accepts empty query for savings positions and optional term_seconds", () => {
    const req = {
      body: {},
      query: {},
      params: {},
    } as unknown as Request;

    validate(savingsPositionsSchema)(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith();
  });

  it("rejects savings positions when term_seconds is invalid", () => {
    const req = {
      body: {},
      query: { term_seconds: "not-a-number" },
      params: {},
    } as unknown as Request;

    expect(() => validate(savingsPositionsSchema)(req, mockRes, mockNext)).toThrow(
      AppError,
    );
  });

  it("rejects withdraw if amount is missing", () => {
    const req = {
      body: { term_seconds: "777" },
      query: {},
      params: {},
    } as unknown as Request;

    expect(() => validate(savingsWithdrawSchema)(req, mockRes, mockNext)).toThrow(
      AppError,
    );
  });
});
