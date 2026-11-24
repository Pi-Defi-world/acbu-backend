/// <reference types="jest" />
import type { NextFunction, Response } from "express";
import { postInvestmentWithdrawRequest } from "./investmentController";
import { prisma } from "../config/database";
import type { AuthRequest } from "../middleware/auth";
import type { AppError } from "../middleware/errorHandler";
import { getInvestmentWithdrawalTiming } from "../services/investment/withdrawalTimingService";

jest.mock("../config/database", () => ({
  prisma: {
    investmentWithdrawalRequest: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock("../services/investment/withdrawalTimingService", () => ({
  getInvestmentWithdrawalTiming: jest.fn(),
}));

const mockCreate = prisma.investmentWithdrawalRequest.create as jest.Mock;
const mockGetInvestmentWithdrawalTiming = getInvestmentWithdrawalTiming as jest.Mock;

const trustedRequestedAt = new Date("2026-05-27T12:00:00.000Z");
const trustedAvailableAt = new Date("2026-05-28T12:00:00.000Z");

const makeRes = () => {
  const res = { status: jest.fn(), json: jest.fn() } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  return res;
};

const makeNext = () => jest.fn() as jest.MockedFunction<NextFunction>;

function makeRequest(body: unknown): AuthRequest {
  return {
    body,
    apiKey: { userId: "user-123", organizationId: null },
  } as AuthRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetInvestmentWithdrawalTiming.mockResolvedValue({
    requestedAt: trustedRequestedAt,
    availableAt: trustedAvailableAt,
    businessCalendarDay: 27,
    isBusinessWithdrawalAllowedDate: true,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("postInvestmentWithdrawRequest", () => {
  it("creates retail withdrawal timing from trusted database time", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2035-01-01T00:00:00.000Z"));
    mockCreate.mockResolvedValue({ id: "withdrawal-1" });
    const res = makeRes();
    const next = makeNext();

    await postInvestmentWithdrawRequest(
      makeRequest({ amount_acbu: "100.00", audience: "retail" }),
      res,
      next,
    );

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        createdAt: trustedRequestedAt,
        availableAt: trustedAvailableAt,
      }),
    });
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        available_at: trustedAvailableAt.toISOString(),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects non-forced business withdrawals using the trusted calendar day", async () => {
    mockGetInvestmentWithdrawalTiming.mockResolvedValue({
      requestedAt: trustedRequestedAt,
      availableAt: trustedAvailableAt,
      businessCalendarDay: 27,
      isBusinessWithdrawalAllowedDate: false,
    });
    const next = makeNext();

    await postInvestmentWithdrawRequest(
      makeRequest({ amount_acbu: "100.00", audience: "business" }),
      makeRes(),
      next,
    );

    expect(mockCreate).not.toHaveBeenCalled();
    const err = next.mock.calls[0][0] as unknown as AppError;
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("INVESTMENT_BUSINESS_CALENDAR");
  });
});
