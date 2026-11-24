import { Request, Response } from "express";
import { exportTransactionReport } from "./reportController";
import { AppError } from "../middleware/errorHandler";
import { getMonthlyStatements } from "../services/reports/reportService";

jest.mock("../services/reports/reportService", () => ({
  getMonthlyStatements: jest.fn(),
}));

type MockResponse = {
  status: jest.Mock;
  setHeader: jest.Mock;
  send: jest.Mock;
  json: jest.Mock;
};

const makeRes = (): MockResponse => {
  const res = {
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as MockResponse;
};

const makeNext = (): jest.MockedFunction<(err?: unknown) => void> =>
  jest.fn() as jest.MockedFunction<(err?: unknown) => void>;

const makeReq = (query: Record<string, unknown> = {}, apiKey?: any) =>
  ({ query, apiKey: apiKey ?? { userId: "user-1" } }) as unknown as Request & { apiKey?: any };

describe("reportController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns JSON statements by default", async () => {
    (getMonthlyStatements as jest.Mock).mockResolvedValue([
      {
        id: "tx-1",
        type: "mint",
        status: "completed",
        acbuAmount: 100,
        acbuAmountBurned: null,
        usdcAmount: 10,
        localCurrency: "NGN",
        localAmount: 5000,
        fee: 2,
        createdAt: new Date("2025-06-01T00:00:00Z"),
        completedAt: new Date("2025-06-01T01:00:00Z"),
      },
    ]);

    const res = makeRes();
    await exportTransactionReport(makeReq({}), res as unknown as Response, makeNext());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      statements: [
        expect.objectContaining({
          id: "tx-1",
          type: "mint",
          status: "completed",
        }),
      ],
      limit: 20,
    });
  });

  it("returns a CSV attachment when format=csv", async () => {
    (getMonthlyStatements as jest.Mock).mockResolvedValue([
      {
        id: "tx-1",
        type: "burn",
        status: "completed",
        acbuAmount: null,
        acbuAmountBurned: 50,
        usdcAmount: 5,
        localCurrency: "KES",
        localAmount: 300,
        fee: 1,
        createdAt: new Date("2025-06-01T00:00:00Z"),
        completedAt: new Date("2025-06-01T01:00:00Z"),
      },
    ]);

    const res = makeRes();
    await exportTransactionReport(
      makeReq({ format: "csv", limit: "10" }),
      res as unknown as Response,
      makeNext(),
    );

    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv; charset=utf-8");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      expect.stringContaining('attachment; filename="acbu_statement_'),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining("transaction_id,type,status"));
  });

  it("returns 400 for unsupported format", async () => {
    const res = makeRes();
    const next = makeNext();

    await exportTransactionReport(makeReq({ format: "xml" }), res as unknown as Response, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0] as Error;
    expect(error).toBeInstanceOf(AppError);
    expect(error.message).toContain("Unsupported format");
  });
});
