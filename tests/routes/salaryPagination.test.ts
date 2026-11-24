// W10-BE-017: salary list endpoints must bound pagination at the HTTP boundary.
import express, { Express } from "express";
import request from "supertest";
import salaryRoutes from "../../src/routes/salaryRoutes";
import { errorHandler } from "../../src/middleware/errorHandler";
import * as salaryService from "../../src/services/salary/salaryService";

jest.mock("../../src/middleware/auth", () => ({
  validateApiKey: (req: any, _res: any, next: any) => {
    req.apiKey = {
      id: "key-1",
      userId: "user-1",
      organizationId: "org-1",
      keyType: "USER_KEY",
      permissions: ["salary:read", "salary:write"],
    };
    next();
  },
}));

jest.mock("../../src/middleware/segmentGuard", () => ({
  requireMinTier: () => (_req: any, _res: any, next: any) => next(),
  requireSegmentScope: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock("../../src/middleware/rateLimiter", () => ({
  apiKeyRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

jest.mock("../../src/services/salary/salaryService", () => ({
  getSalaryBatches: jest.fn(),
  getSalarySchedules: jest.fn(),
  createSalaryBatch: jest.fn(),
  createSalarySchedule: jest.fn(),
}));

const getBatches = salaryService.getSalaryBatches as jest.Mock;
const getSchedules = salaryService.getSalarySchedules as jest.Mock;

const batchRow = {
  id: "batch-1",
  status: "completed",
  totalAmount: { toString: () => "1000.00" },
  currency: "ACBU",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  _count: { items: 2 },
};

const scheduleRow = {
  id: "sched-1",
  name: "Payroll",
  cron: "0 0 * * *",
  status: "active",
  nextRunAt: new Date("2026-02-01T00:00:00.000Z"),
};

describe("Salary list endpoints - bounded pagination (W10-BE-017)", () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use("/v1/salary", salaryRoutes);
    app.use(errorHandler);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    getBatches.mockResolvedValue([batchRow]);
    getSchedules.mockResolvedValue([scheduleRow]);
  });

  describe("GET /v1/salary/batches", () => {
    it("applies default pagination when no query is supplied", async () => {
      const res = await request(app).get("/v1/salary/batches").expect(200);

      expect(getBatches).toHaveBeenCalledWith({
        userId: "user-1",
        organizationId: "org-1",
        limit: 20,
        offset: 0,
      });
      expect(res.body.pagination).toEqual({ limit: 20, offset: 0 });
      expect(res.body.batches).toEqual([
        {
          batch_id: "batch-1",
          status: "completed",
          total_amount: "1000.00",
          currency: "ACBU",
          created_at: "2026-01-01T00:00:00.000Z",
          item_count: 2,
        },
      ]);
    });

    it("clamps an oversized limit to 100 and passes the offset through", async () => {
      const res = await request(app).get("/v1/salary/batches?limit=5000&offset=40").expect(200);

      expect(getBatches).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, offset: 40 }));
      expect(res.body.pagination).toEqual({ limit: 100, offset: 40 });
    });

    it("normalises invalid limit/offset to the defaults", async () => {
      const res = await request(app).get("/v1/salary/batches?limit=-5&offset=abc").expect(200);

      expect(getBatches).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, offset: 0 }));
      expect(res.body.pagination).toEqual({ limit: 20, offset: 0 });
    });
  });

  describe("GET /v1/salary/schedules", () => {
    it("paginates schedules instead of returning them unbounded", async () => {
      const res = await request(app).get("/v1/salary/schedules").expect(200);

      expect(getSchedules).toHaveBeenCalledWith({
        userId: "user-1",
        organizationId: "org-1",
        limit: 20,
        offset: 0,
      });
      expect(res.body.pagination).toEqual({ limit: 20, offset: 0 });
      expect(res.body.schedules).toEqual([
        {
          schedule_id: "sched-1",
          name: "Payroll",
          cron: "0 0 * * *",
          status: "active",
          next_run_at: "2026-02-01T00:00:00.000Z",
        },
      ]);
    });

    it("clamps an oversized limit to 100 and passes the offset through", async () => {
      const res = await request(app).get("/v1/salary/schedules?limit=1000&offset=20").expect(200);

      expect(getSchedules).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100, offset: 20 }),
      );
      expect(res.body.pagination).toEqual({ limit: 100, offset: 20 });
    });
  });
});
