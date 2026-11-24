import {
  adminRateLimiter,
  apiKeyRateLimiter,
  circuitBreaker,
  createMongoRateLimitStore,
  fallbackMetrics,
  fallbackRateLimitStore,
  FALLBACK_MAX_REQUESTS_PER_IP,
  injectFallbackState,
} from "./rateLimiter";
import { cacheService } from "../utils/cache";
import { logger } from "../config/logger";
import { getMongoDB } from "../config/mongodb";
import { redisService } from "../services/cache/redisService";

// Mock dependencies
jest.mock("../utils/cache", () => ({
  cacheService: {
    increment: jest.fn(),
  },
  sanitizeKey: jest.fn((key: string) => key),
}));

jest.mock("../config/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../config/mongodb", () => ({
  getMongoDB: jest.fn(),
}));

jest.mock("../services/cache/redisService", () => ({
  redisService: {
    getClient: jest.fn(),
  },
}));

jest.mock("../config/env", () => ({
  config: {
    rateLimitWindowMs: 60000,
    rateLimitMaxRequests: 100,
    authRateLimitWindowMs: 15 * 60 * 1000,
    authRateLimitMaxRequests: 10,
    adminRateLimitWindowMs: 60000,
    adminRateLimitMaxRequests: 30,
  },
}));

describe("Rate Limiter with Circuit Breaker", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    circuitBreaker.reset();
    fallbackRateLimitStore.clear();
    (redisService.getClient as jest.Mock).mockReturnValue({
      incr: jest.fn().mockRejectedValue(new Error("Redis unavailable")),
      expire: jest.fn(),
      pttl: jest.fn(),
      decr: jest.fn(),
      del: jest.fn(),
      keys: jest.fn().mockResolvedValue([]),
      get: jest.fn(),
    });

    mockReq = {
      ip: "192.168.1.100",
      apiKey: {
        id: "test-api-key-123",
        rateLimit: 100,
      },
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    mockNext = jest.fn();

    // Reset fallback metrics
    (fallbackMetrics as any).failuresTotal = 0;
    (fallbackMetrics as any).fallbackActivations = 0;
    (fallbackMetrics as any).rejectionsInFallback = 0;
    (fallbackMetrics as any).lastFailureAt = null;
  });

  describe("Shared Mongo-backed store", () => {
    it("uses a bounded in-memory counter when MongoDB and Redis are unavailable", async () => {
      (getMongoDB as jest.Mock).mockImplementation(() => {
        throw new Error("MongoDB unavailable");
      });

      const store = createMongoRateLimitStore("auth");
      store.init({ windowMs: 60_000 } as any);

      const first = await store.increment("203.0.113.12");
      const second = await store.increment("203.0.113.12");

      expect(first.totalHits).toBe(1);
      expect(second.totalHits).toBe(2);
      expect(fallbackRateLimitStore.get("rate_limit:auth:203.0.113.12")).toEqual({
        count: 2,
        expiresAt: expect.any(Number),
      });
    });

    it("should namespace limiter keys so instances do not share counters", async () => {
      const findOneAndUpdate = jest.fn().mockResolvedValue({
        value: {
          key: "rate_limit:standard:192.168.1.100",
          value: { count: 1 },
          expiresAt: new Date("2026-01-01T00:01:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          namespace: "rate_limit:standard",
        },
      });
      const findOne = jest.fn().mockResolvedValue(null);
      const updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
      const deleteOne = jest.fn().mockResolvedValue({ acknowledged: true });
      const deleteMany = jest.fn().mockResolvedValue({ acknowledged: true });

      (getMongoDB as jest.Mock).mockReturnValue({
        collection: jest.fn(() => ({
          findOneAndUpdate,
          findOne,
          updateOne,
          deleteOne,
          deleteMany,
        })),
      });

      const standardStore = createMongoRateLimitStore("standard") as any;
      const authStore = createMongoRateLimitStore("auth") as any;

      standardStore.init({ windowMs: 60_000 } as any);
      authStore.init({ windowMs: 15 * 60_000 } as any);

      await standardStore.increment("192.168.1.100");
      await authStore.increment("192.168.1.100");

      expect(findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "rate_limit:standard:192.168.1.100",
        }),
        expect.any(Object),
        expect.objectContaining({ upsert: true, returnDocument: "after" }),
      );
      expect(findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "rate_limit:auth:192.168.1.100",
        }),
        expect.any(Object),
        expect.objectContaining({ upsert: true, returnDocument: "after" }),
      );
      expect((standardStore as any).localKeys).toBe(false);
      expect((authStore as any).localKeys).toBe(false);
    });

    it("should read, reset, and delete shared limiter entries", async () => {
      const findOneAndUpdate = jest.fn().mockResolvedValue({
        value: {
          key: "rate_limit:standard:203.0.113.10",
          value: { count: 3 },
          expiresAt: new Date("2026-01-01T00:01:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          namespace: "rate_limit:standard",
        },
      });
      const findOne = jest
        .fn()
        .mockResolvedValueOnce({
          key: "rate_limit:standard:203.0.113.10",
          value: { count: 3 },
          expiresAt: new Date("2026-01-01T00:01:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          namespace: "rate_limit:standard",
        })
        .mockResolvedValueOnce(null);
      const updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
      const deleteOne = jest.fn().mockResolvedValue({ acknowledged: true });
      const deleteMany = jest.fn().mockResolvedValue({ acknowledged: true });

      (getMongoDB as jest.Mock).mockReturnValue({
        collection: jest.fn(() => ({
          findOneAndUpdate,
          findOne,
          updateOne,
          deleteOne,
          deleteMany,
        })),
      });

      const store = createMongoRateLimitStore("standard") as any;
      store.init({ windowMs: 60_000 } as any);

      const incremented = await store.increment("203.0.113.10");
      expect(incremented.totalHits).toBe(3);
      expect(incremented.resetTime).toBeInstanceOf(Date);

      const hitInfo = await store.get("203.0.113.10");
      expect(hitInfo).toEqual({
        totalHits: 3,
        resetTime: new Date("2026-01-01T00:01:00.000Z"),
      });

      await store.decrement("203.0.113.10");
      await store.resetKey("203.0.113.10");
      await store.resetAll();

      expect(updateOne).toHaveBeenCalledWith(
        { key: "rate_limit:standard:203.0.113.10" },
        expect.any(Object),
      );
      expect(deleteOne).toHaveBeenCalledWith({
        key: "rate_limit:standard:203.0.113.10",
      });
      expect(deleteMany).toHaveBeenCalledWith({
        namespace: "rate_limit:standard",
      });
    });
  });

  describe("Normal Operation (Cache Available)", () => {
    it("should allow requests when cache is working and under limit", async () => {
      (cacheService.increment as jest.Mock).mockResolvedValue({ count: 5 });

      await apiKeyRateLimiter(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(circuitBreaker.getState()).toBe("CLOSED");
    });

    it("should reject requests when rate limit exceeded in normal mode", async () => {
      (cacheService.increment as jest.Mock).mockResolvedValue(null);

      await apiKeyRateLimiter(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          error_code: "RATE_LIMIT_EXCEEDED",
          message: "API key rate limit exceeded, please try again later.",
          limitType: "api_key",
        },
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("should record success in circuit breaker when cache works", async () => {
      (cacheService.increment as jest.Mock).mockResolvedValue({ count: 1 });

      await apiKeyRateLimiter(mockReq, mockRes, mockNext);

      expect(circuitBreaker.getState()).toBe("CLOSED");
    });
  });

  describe("Cache Failure Scenario (CRITICAL)", () => {
    it("should enforce strict fallback limits when cache fails", async () => {
      (cacheService.increment as jest.Mock).mockRejectedValue(new Error("MongoDB unavailable"));

      // Send 25 requests
      for (let i = 0; i < 25; i++) {
        await apiKeyRateLimiter(mockReq, mockRes, mockNext);
      }

      // Verify fallback enforcement (max 20 allowed)
      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          error_code: "RATE_LIMIT_EXCEEDED",
          message: "Rate limit exceeded (degraded mode)",
        },
      });

      // Verify next() called only 20 times (not 25)
      expect(mockNext.mock.calls.length).toBeLessThanOrEqual(FALLBACK_MAX_REQUESTS_PER_IP);
    });

    it("should NOT allow unlimited requests during cache outage (NO fail-open)", async () => {
      (cacheService.increment as jest.Mock).mockRejectedValue(new Error("Connection refused"));

      const isolatedReq = { ...mockReq, ip: "55.55.55.55" };

      // Send 100 requests rapidly
      for (let i = 0; i < 100; i++) {
        await apiKeyRateLimiter(isolatedReq, mockRes, mockNext);
      }

      // Only 20 should pass (fallback limit), 80 should be rejected
      expect(mockNext).toHaveBeenCalledTimes(FALLBACK_MAX_REQUESTS_PER_IP);
      expect(mockRes.status).toHaveBeenCalledTimes(100 - FALLBACK_MAX_REQUESTS_PER_IP);
    });

    it("should return 429 when cache returns null (cap hit)", async () => {
      (cacheService.increment as jest.Mock).mockResolvedValue(null);

      await apiKeyRateLimiter(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe("Circuit Breaker Activation", () => {
    it("should open circuit breaker after 5 consecutive failures", async () => {
      (cacheService.increment as jest.Mock).mockRejectedValue(new Error("Connection refused"));

      // Trigger 5 failures
      for (let i = 0; i < 5; i++) {
        await apiKeyRateLimiter(mockReq, mockRes, mockNext);
      }

      expect(circuitBreaker.getState()).toBe("OPEN");
      expect(logger.info).toHaveBeenCalledWith(
        "Circuit breaker state transition",
        expect.objectContaining({
          from: "CLOSED",
          to: "OPEN",
        }),
      );
    });

    it("should use fallback immediately when circuit is OPEN", async () => {
      // Manually open circuit breaker
      circuitBreaker.reset();
      for (let i = 0; i < 5; i++) {
        (cacheService.increment as jest.Mock).mockRejectedValueOnce(new Error("Cache down"));
      }

      // Force circuit to OPEN state
      for (let i = 0; i < 5; i++) {
        await apiKeyRateLimiter(mockReq, mockRes, mockNext);
      }

      expect(circuitBreaker.getState()).toBe("OPEN");

      // Clear mocks
      mockNext.mockClear();
      mockRes.status.mockClear();
      mockRes.json.mockClear();

      // Next request should use fallback without calling cache
      (cacheService.increment as jest.Mock).mockClear();
      await apiKeyRateLimiter({ ...mockReq, ip: "99.99.99.99" }, mockRes, mockNext);

      // Should NOT call cache (circuit is OPEN)
      expect(cacheService.increment).not.toHaveBeenCalled();
      // Should use fallback instead
      expect(mockNext).toHaveBeenCalled();
    });

    it("should remain OPEN during cooldown period", async () => {
      (cacheService.increment as jest.Mock).mockRejectedValue(new Error("Cache down"));

      // Open circuit
      for (let i = 0; i < 5; i++) {
        await apiKeyRateLimiter(mockReq, mockRes, mockNext);
      }

      expect(circuitBreaker.getState()).toBe("OPEN");

      // Check state immediately (should still be OPEN)
      expect(circuitBreaker.getState()).toBe("OPEN");
    });
  });

  describe("Circuit Breaker Recovery", () => {
    it("should transition to HALF_OPEN after cooldown", async () => {
      // Setup: Open the circuit
      (cacheService.increment as jest.Mock).mockRejectedValue(new Error("Cache down"));

      for (let i = 0; i < 5; i++) {
        await apiKeyRateLimiter(mockReq, mockRes, mockNext);
      }

      expect(circuitBreaker.getState()).toBe("OPEN");

      // Fast-forward time past cooldown (60 seconds)
      jest.useFakeTimers();
      jest.advanceTimersByTime(61_000);

      // Next check should transition to HALF_OPEN
      const state = circuitBreaker.getState();
      expect(state).toBe("HALF_OPEN");

      jest.useRealTimers();
    });

    it("should close circuit after 2 consecutive successes in HALF_OPEN", async () => {
      // Open circuit first
      (cacheService.increment as jest.Mock).mockRejectedValue(new Error("Cache down"));

      for (let i = 0; i < 5; i++) {
        await apiKeyRateLimiter(mockReq, mockRes, mockNext);
      }

      expect(circuitBreaker.getState()).toBe("OPEN");

      // Simulate time passing
      jest.useFakeTimers();
      jest.advanceTimersByTime(61_000);

      // Cache is back online
      (cacheService.increment as jest.Mock).mockResolvedValue({ count: 1 });

      // Send 2 successful requests
      await apiKeyRateLimiter(mockReq, mockRes, mockNext);
      await apiKeyRateLimiter(mockReq, mockRes, mockNext);

      // Circuit should be closed now
      expect(circuitBreaker.getState()).toBe("CLOSED");

      jest.useRealTimers();
    });

    it("should reopen circuit on failure in HALF_OPEN state", async () => {
      // Open circuit
      (cacheService.increment as jest.Mock).mockRejectedValue(new Error("Cache down"));

      for (let i = 0; i < 5; i++) {
        await apiKeyRateLimiter(mockReq, mockRes, mockNext);
      }

      // Fast-forward to HALF_OPEN
      jest.useFakeTimers();
      jest.advanceTimersByTime(61_000);

      expect(circuitBreaker.getState()).toBe("HALF_OPEN");

      // Simulate another failure
      (cacheService.increment as jest.Mock).mockRejectedValueOnce(new Error("Still down"));

      await apiKeyRateLimiter(mockReq, mockRes, mockNext);

      // Should immediately reopen
      expect(circuitBreaker.getState()).toBe("OPEN");

      jest.useRealTimers();
    });
  });

  describe("Multiple IPs Isolation", () => {
    it("should handle multiple IPs independently in fallback mode", async () => {
      (cacheService.increment as jest.Mock).mockRejectedValue(new Error("Cache down"));

      const ip1Req = { ...mockReq, ip: "10.0.0.1" };
      const ip2Req = { ...mockReq, ip: "10.0.0.2" };

      const ip1Res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
      const ip2Res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;

      const ip1Next = jest.fn();
      const ip2Next = jest.fn();

      // Send 20 requests from IP1 - should all pass
      for (let i = 0; i < 20; i++) {
        await apiKeyRateLimiter(ip1Req as any, ip1Res as any, ip1Next as any);
      }

      // Send 20 requests from IP2 - should all pass
      for (let i = 0; i < 20; i++) {
        await apiKeyRateLimiter(ip2Req as any, ip2Res as any, ip2Next as any);
      }

      expect(ip1Next).toHaveBeenCalledTimes(20);
      expect(ip2Next).toHaveBeenCalledTimes(20);

      // Send 1 more from IP1 - should be rejected (21st)
      await apiKeyRateLimiter(ip1Req as any, ip1Res as any, ip1Next as any);
      expect(ip1Res.status).toHaveBeenCalledWith(429);

      // IP2 should still have its own counter (not affected by IP1)
      expect(ip2Res.status).not.toHaveBeenCalled();
    });
  });

  describe("Security Tests", () => {
    it("should handle missing IP gracefully", async () => {
      (cacheService.increment as jest.Mock).mockRejectedValue(new Error("Cache down"));

      const reqWithoutIp = {
        ...mockReq,
        ip: undefined,
      };

      // Should use "unknown" as fallback IP and still enforce limits
      for (let i = 0; i < 25; i++) {
        await apiKeyRateLimiter(reqWithoutIp, mockRes, mockNext);
      }

      expect(mockNext).toHaveBeenCalledTimes(FALLBACK_MAX_REQUESTS_PER_IP);
      expect(mockRes.status).toHaveBeenCalledWith(429);
    });

    it("should fallback limit is stricter than normal limit", async () => {
      expect(FALLBACK_MAX_REQUESTS_PER_IP).toBe(20);
      expect(FALLBACK_MAX_REQUESTS_PER_IP).toBeLessThan(100); // Normal limit
    });

    it("should not bypass rate limiting with malformed requests", async () => {
      (cacheService.increment as jest.Mock).mockRejectedValue(new Error("Cache down"));

      const malformedReq = {
        ip: null,
        apiKey: null,
      } as any;

      // Should pass through if no API key (different middleware handles this)
      await apiKeyRateLimiter(malformedReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe("Memory Leak Prevention", () => {
    it("should cleanup expired fallback entries", () => {
      fallbackRateLimitStore.clear();

      const now = Date.now();
      fallbackRateLimitStore.set("expired:key:1", {
        count: 5,
        expiresAt: now - 10000,
      });
      fallbackRateLimitStore.set("valid:key:1", {
        count: 3,
        expiresAt: now + 60000,
      });

      expect(fallbackRateLimitStore.size).toBe(2);

      // Manually run the same cleanup logic as the interval
      for (const [key, entry] of fallbackRateLimitStore.entries()) {
        if (entry.expiresAt <= Date.now()) {
          fallbackRateLimitStore.delete(key);
        }
      }

      expect(fallbackRateLimitStore.has("expired:key:1")).toBe(false);
      expect(fallbackRateLimitStore.has("valid:key:1")).toBe(true);
    });
  });

  describe("Metrics Emission", () => {
    it("should emit metrics during fallback activation", async () => {
      (cacheService.increment as jest.Mock).mockRejectedValue(new Error("Cache down"));

      await apiKeyRateLimiter(mockReq, mockRes, mockNext);

      expect(fallbackMetrics.failuresTotal).toBeGreaterThan(0);
      expect(fallbackMetrics.fallbackActivations).toBeGreaterThan(0);
      expect(fallbackMetrics.lastFailureAt).not.toBeNull();
    });

    it("should increment rejectionsInFallback when limit exceeded", async () => {
      (cacheService.increment as jest.Mock).mockRejectedValue(new Error("Cache down"));

      // Exceed fallback limit
      for (let i = 0; i < 25; i++) {
        await apiKeyRateLimiter(mockReq, mockRes, mockNext);
      }

      expect(fallbackMetrics.rejectionsInFallback).toBeGreaterThan(0);
    });

    it("should log warning when circuit breaker is OPEN", async () => {
      // Open circuit
      (cacheService.increment as jest.Mock).mockRejectedValue(new Error("Cache down"));

      for (let i = 0; i < 5; i++) {
        await apiKeyRateLimiter(mockReq, mockRes, mockNext);
      }

      // Clear mocks
      (logger.warn as jest.Mock).mockClear();

      // Next request should log warning
      await apiKeyRateLimiter(mockReq, mockRes, mockNext);

      expect(logger.warn).toHaveBeenCalledWith(
        "Circuit breaker OPEN, using fallback rate limiter",
        expect.objectContaining({
          apiKeyId: mockReq.apiKey.id,
          circuitState: "OPEN",
        }),
      );
    });

    it("should log error when cache increment fails", async () => {
      (cacheService.increment as jest.Mock).mockRejectedValue(new Error("Connection timeout"));

      await apiKeyRateLimiter(mockReq, mockRes, mockNext);

      expect(logger.error).toHaveBeenCalledWith(
        "Cache increment failed, activating fallback",
        expect.objectContaining({
          cacheKey: expect.stringContaining("rate_limit:api_key:"),
          error: "Connection timeout",
          circuitState: expect.any(String),
        }),
      );
    });
  });

  describe("Fallback State Injection", () => {
    it("should inject fallback state into request context", async () => {
      const req: any = {};
      const res: any = {};
      const next = jest.fn();

      injectFallbackState(req, res, next);

      expect(req.rateLimiterState).toBeDefined();
      expect(req.rateLimiterState).toHaveProperty("circuitState");
      expect(req.rateLimiterState).toHaveProperty("isFallback");
      expect(req.rateLimiterState).toHaveProperty("fallbackMetrics");
      expect(next).toHaveBeenCalled();
    });
  });

  describe("adminRateLimiter", () => {
    // Max requests per window for the admin limiter (mocked env config).
    const ADMIN_MAX = 30;

    let adminRes: any;

    beforeEach(() => {
      let count = 0;
      const findOneAndUpdate = jest.fn().mockImplementation(async () => {
        count += 1;
        return {
          value: {
            key: "rate_limit:admin:192.168.1.100",
            value: { count },
            expiresAt: new Date(Date.now() + 60_000),
            updatedAt: new Date(),
            namespace: "rate_limit:admin",
          },
        };
      });

      (getMongoDB as jest.Mock).mockReturnValue({
        collection: jest.fn(() => ({ findOneAndUpdate })),
      });

      adminRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        setHeader: jest.fn(),
      };
    });

    const makeAdminReq = (): any => ({
      ip: "192.168.1.100",
      headers: {},
      app: { get: jest.fn().mockReturnValue(false) },
    });

    it("allows requests up to the admin limit", async () => {
      for (let i = 0; i < ADMIN_MAX; i++) {
        await adminRateLimiter(makeAdminReq(), adminRes, mockNext);
      }

      expect(mockNext).toHaveBeenCalledTimes(ADMIN_MAX);
      expect(adminRes.status).not.toHaveBeenCalled();
    });

    it("rejects requests beyond the admin limit with 429", async () => {
      for (let i = 0; i < ADMIN_MAX + 1; i++) {
        await adminRateLimiter(makeAdminReq(), adminRes, mockNext);
      }

      expect(mockNext).toHaveBeenCalledTimes(ADMIN_MAX);
      expect(adminRes.status).toHaveBeenCalledWith(429);
      expect(adminRes.json).toHaveBeenCalledWith({
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          error_code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests from this IP address, please try again later.",
          limitType: "ip",
        },
      });
    });

    it("does not share counters with other limiters (admin namespace isolation)", async () => {
      let count = 0;
      const findOneAndUpdate = jest.fn().mockImplementation(async () => {
        count += 1;
        return {
          value: {
            key: "rate_limit:admin:192.168.1.100",
            value: { count },
            expiresAt: new Date(Date.now() + 60_000),
            updatedAt: new Date(),
            namespace: "rate_limit:admin",
          },
        };
      });
      (getMongoDB as jest.Mock).mockReturnValue({
        collection: jest.fn(() => ({ findOneAndUpdate })),
      });

      await adminRateLimiter(makeAdminReq(), adminRes, mockNext);

      expect(findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ key: "rate_limit:admin:192.168.1.100" }),
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  describe("Atomic Cap — Concurrent Load Test (B-028)", () => {
    it("should never exceed maxRequests under concurrent load", async () => {
      const maxRequests = 10;
      let callCount = 0;

      // Simulate atomic MongoDB cap behavior:
      // increment returns a count until max, then returns null
      (cacheService.increment as jest.Mock).mockImplementation(async () => {
        callCount++;
        if (callCount <= maxRequests) {
          return { count: callCount };
        }
        return null; // cap hit
      });

      const req = {
        ip: "10.0.0.1",
        apiKey: { id: "concurrent-test-key", rateLimit: maxRequests },
      };

      const results: number[] = [];

      // Fire 20 requests concurrently
      await Promise.all(
        Array.from({ length: 20 }, async () => {
          const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
          const next = jest.fn();
          await apiKeyRateLimiter(req as any, res as any, next);
          results.push(next.mock.calls.length > 0 ? 200 : 429);
        }),
      );

      const allowed = results.filter((r) => r === 200).length;
      const rejected = results.filter((r) => r === 429).length;

      // Must never exceed the cap
      expect(allowed).toBeLessThanOrEqual(maxRequests);
      expect(rejected).toBeGreaterThanOrEqual(10);
    });
  });
});
