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

  it("keeps the treasury endpoint stub intact", async () => {
    const { getTreasury } = await import("./enterpriseController");
    const res = makeRes();
    const next = makeNext();

    await getTreasury({} as AuthRequest, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({
      message: "Treasury view not yet implemented.",
    });
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
