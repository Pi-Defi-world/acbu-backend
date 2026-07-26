import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { EventEmitter } from "events";
import type { NextFunction, Response } from "express";
import { postBulkTransfer } from "./enterpriseController";
import { captureCsvUpload } from "../routes/enterpriseRoutes";
import { requireMinTier } from "../middleware/segmentGuard";
import type { AuthRequest } from "../middleware/auth";

jest.mock("../services/enterpriseService", () => ({
  processBulkTransfer: jest.fn(),
}));

import { processBulkTransfer } from "../services/enterpriseService";

jest.mock("../services/treasury/TreasuryService", () => ({
  getEnterpriseTreasury: jest.fn(),
}));

import { getEnterpriseTreasury } from "../services/treasury/TreasuryService";

const makeRes = () => {
  const res = { status: jest.fn(), json: jest.fn() } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  (res.json as jest.Mock).mockReturnValue(res);
  return res;
};

const makeNext = () => jest.fn() as unknown as NextFunction;

const makeFileReq = (overrides: Partial<AuthRequest> & { file?: any } = {}) =>
  ({
    apiKey: { userId: "user-1", organizationId: "org-1", permissions: ["enterprise:write"], rateLimit: 100 },
    file: {
      buffer: Buffer.from("to,amount_acbu\nrecipient,1.0\n"),
      originalname: "bulk.csv",
      mimetype: "text/csv",
      size: 32,
    },
    ...overrides,
  }) as unknown as AuthRequest;

describe("enterpriseController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 200 with the bulk transfer job result", async () => {
    (processBulkTransfer as jest.Mock<any>).mockResolvedValue({
      jobId: "job-1",
      totalRows: 1,
      successCount: 1,
      failureCount: 0,
      skippedCount: 0,
      status: "completed",
      createdAt: new Date().toISOString(),
      failureReport: [],
    });

    const res = makeRes();
    const next = makeNext();

    await postBulkTransfer(makeFileReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({
      job_id: "job-1",
      status: "completed",
    });
  });

  it("returns 401 when enterprise identity is missing", async () => {
    const next = makeNext();

    await postBulkTransfer(makeFileReq({ apiKey: undefined }), makeRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 }),
    );
  });

  it("rejects non-CSV file uploads", async () => {
    const next = makeNext();

    await postBulkTransfer(
      makeFileReq({
        file: {
          buffer: Buffer.from("hello"),
          originalname: "bulk.txt",
          mimetype: "text/plain",
          size: 5,
        },
      }),
      makeRes(),
      next,
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 }),
    );
  });

  it("returns the enterprise treasury from the treasury service", async () => {
    const mockTreasury = {
      totalBalanceUsd: 1_234_567.89,
      totalReserveAmount: 1_000_000.0,
      summary: {
        transactionsSegmentUsd: 800_000.0,
        investmentSavingsSegmentUsd: 434_567.89,
      },
      byCurrency: [
        {
          currency: "USD",
          targetWeight: null,
          transactions: {
            currency: "USD",
            segment: "transactions",
            reserveAmount: 800_000,
            reserveValueUsd: 800_000,
            fxRate: 1,
            fxRateTimestamp: new Date().toISOString(),
            fxRateSource: "current",
          },
          investmentSavings: {
            currency: "USD",
            segment: "investment_savings",
            reserveAmount: 434_567.89,
            reserveValueUsd: 434_567.89,
            fxRate: 1,
            fxRateTimestamp: new Date().toISOString(),
            fxRateSource: "current",
          },
          combined: {
            reserveAmount: 1_234_567.89,
            reserveValueUsd: 1_234_567.89,
          },
        },
      ],
      reconciliation: {
        ledgerTotal: 1_234_567.89,
        calculatedTotal: 1_234_560.0,
        discrepancy: 7.89,
        discrepancyPercentage: 0.00064,
        isReconciled: true,
        tolerancePercentage: 0.01,
        warnings: [],
      },
      message: "Treasury reconciliation successful",
    };

    (getEnterpriseTreasury as jest.Mock<any>).mockResolvedValue(mockTreasury);

    const { getTreasury } = await import("./enterpriseController");
    const res = makeRes();
    const next = makeNext();

    await getTreasury({ apiKey: { organizationId: "org-1" } } as AuthRequest, res, next);

    expect(getEnterpriseTreasury).toHaveBeenCalledWith("org-1");
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.json as jest.Mock).mock.calls[0][0]).toEqual(mockTreasury);
  });
});

describe("enterprise upload middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects files larger than the middleware limit", async () => {
    const req = new EventEmitter() as unknown as AuthRequest & EventEmitter & { destroy: jest.Mock };
    req.headers = {
      "content-type": "text/csv",
      "x-filename": "bulk.csv",
    } as any;
    (req as any).destroy = jest.fn() as jest.Mock<any>;
    const res = makeRes();
    const next = makeNext();

    captureCsvUpload(req, res, next);
    req.emit("data", Buffer.alloc(10 * 1024 * 1024 + 1));
    req.emit("end");

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 413 }),
    );
  });

  it("rejects users below enterprise tier", () => {
    const middleware = requireMinTier("enterprise");
    const next = makeNext();

    middleware(
      {
        userTier: "free",
        apiKey: { userId: "user-1", organizationId: "org-1", permissions: ["enterprise:write"], rateLimit: 100 },
      } as AuthRequest,
      makeRes(),
      next,
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });
});
