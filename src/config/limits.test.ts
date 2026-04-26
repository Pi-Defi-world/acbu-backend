jest.mock("./database", () => ({
  prisma: {
    limitConfig: {
      findMany: jest.fn(),
    },
  },
}));

import { prisma } from "./database";
import {
  getCircuitBreakerMinReserveRatio,
  getLimitConfig,
  invalidateLimitsConfigCache,
} from "./limits";

const mockFindMany = (
  prisma as unknown as {
    limitConfig: { findMany: jest.Mock };
  }
).limitConfig.findMany;

describe("runtime limits config", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateLimitsConfigCache();
    delete process.env.LIMIT_RETAIL_DEPOSIT_DAILY_USD;
    process.env.LIMIT_CONFIG_CACHE_TTL_MS = "0";
  });

  afterAll(() => {
    delete process.env.LIMIT_CONFIG_CACHE_TTL_MS;
    delete process.env.LIMIT_RETAIL_DEPOSIT_DAILY_USD;
  });

  it("uses DB overrides over env/default limits", async () => {
    process.env.LIMIT_CONFIG_CACHE_TTL_MS = "60000";
    mockFindMany.mockResolvedValueOnce([
      {
        scope: "retail",
        values: { depositDailyUsd: 2500 },
      },
      {
        scope: "circuit_breaker",
        values: { minReserveRatio: 1.08 },
      },
    ]);

    await expect(getLimitConfig("retail")).resolves.toMatchObject({
      depositDailyUsd: 2500,
      depositMonthlyUsd: 50000,
    });
    await expect(getCircuitBreakerMinReserveRatio()).resolves.toBe(1.08);
  });

  it("refreshes from DB after cache expiry without module reload", async () => {
    mockFindMany
      .mockResolvedValueOnce([
        { scope: "retail", values: { depositDailyUsd: 1000 } },
      ])
      .mockResolvedValueOnce([
        { scope: "retail", values: { depositDailyUsd: 3000 } },
      ]);

    await expect(getLimitConfig("retail")).resolves.toMatchObject({
      depositDailyUsd: 1000,
    });
    await expect(getLimitConfig("retail")).resolves.toMatchObject({
      depositDailyUsd: 3000,
    });
  });

  it("falls back to live env values when no DB override exists", async () => {
    process.env.LIMIT_RETAIL_DEPOSIT_DAILY_USD = "7500";
    mockFindMany.mockResolvedValueOnce([]);

    await expect(getLimitConfig("retail")).resolves.toMatchObject({
      depositDailyUsd: 7500,
    });
  });

  it("falls back to env defaults when the DB read fails", async () => {
    process.env.LIMIT_RETAIL_DEPOSIT_DAILY_USD = "6500";
    mockFindMany.mockRejectedValueOnce(new Error("connection dropped"));

    await expect(getLimitConfig("retail")).resolves.toMatchObject({
      depositDailyUsd: 6500,
    });
  });

  it("serves stale cached limits when refresh fails", async () => {
    mockFindMany
      .mockResolvedValueOnce([
        { scope: "retail", values: { depositDailyUsd: 1200 } },
      ])
      .mockRejectedValueOnce(new Error("pool exhausted"));

    await expect(getLimitConfig("retail")).resolves.toMatchObject({
      depositDailyUsd: 1200,
    });
    await expect(getLimitConfig("retail")).resolves.toMatchObject({
      depositDailyUsd: 1200,
    });
  });

  it("shares one DB refresh across concurrent cache misses", async () => {
    process.env.LIMIT_CONFIG_CACHE_TTL_MS = "60000";
    mockFindMany.mockResolvedValueOnce([
      { scope: "retail", values: { depositDailyUsd: 1800 } },
    ]);

    const [first, second, third] = await Promise.all([
      getLimitConfig("retail"),
      getLimitConfig("retail"),
      getLimitConfig("retail"),
    ]);

    expect(first.depositDailyUsd).toBe(1800);
    expect(second.depositDailyUsd).toBe(1800);
    expect(third.depositDailyUsd).toBe(1800);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });
});
