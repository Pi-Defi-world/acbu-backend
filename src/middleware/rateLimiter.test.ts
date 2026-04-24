import {
  apiKeyRateLimiter,
  circuitBreaker,
  fallbackMetrics,
  FALLBACK_MAX_REQUESTS_PER_IP,
} from "./rateLimiter";
import { cacheService } from "../utils/cache";
import { logger } from "../config/logger";

// Mock dependencies
jest.mock("../utils/cache", () => ({
  cacheService: {
    increment: jest.fn(),
  },
}));

jest.mock("../config/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../config/env", () => ({
  config: {
    rateLimitWindowMs: 60000,
    rateLimitMaxRequests: 100,
  },
}));

describe("Rate Limiter with Circuit Breaker", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    circuitBreaker.reset();

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

  describe("Normal Operation (Cache Available)", () => {
    it("should allow requests when cache is working and under limit", async () => {
      (cacheService.increment as jest.Mock).mockResolvedValue({ count: 5 });

      await apiKeyRateLimiter(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(circuitBreaker.getState()).toBe("CLOSED");
    });

    it("should reject requests when rate limit exceeded in normal mode", async () => {
      (cacheService.increment as jest.Mock).mockResolvedValue({ count: 101 });

      await apiKeyRateLimiter(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "API key rate limit exceeded",
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
      (cacheService.increment as jest.Mock).mockRejectedValue(
        new Error("MongoDB unavailable"),
      );

      // Send 25 requests
      for (let i = 0; i < 25; i++) {
        await apiKeyRateLimiter(mockReq, mockRes, mockNext);
      }

      // Verify fallback enforcement (max 20 allowed)
      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Rate limit exceeded (degraded mode)",
        },
      });

      // Verify next() called only 20 times (not 25)
      expect(mockNext).toHaveBeenCalledTimes(FALLBACK_MAX_REQUESTS_PER_IP);
    });

    it("should NOT allow unlimited requests during cache outage (NO fail-open)", async () => {
      (cacheService.increment as jest.Mock).mockRejectedValue(
        new Error("Connection refused"),
      );

      // Send 100 requests rapidly
      for (let i = 0; i < 100; i++) {
        await apiKeyRateLimiter(mockReq, mockRes, mockNext);
      }

      // Only 20 should pass (fallback limit), 80 should be rejected
      expect(mockNext).toHaveBeenCalledTimes(FALLBACK_MAX_REQUESTS_PER_IP);
      expect(mockRes.status).toHaveBeenCalledTimes(
        100 - FALLBACK_MAX_REQUESTS_PER_IP,
      );
    });

    it("should activate fallback when cache returns null", async () => {
      (cacheService.increment as jest.Mock).mockResolvedValue(null);

      await apiKeyRateLimiter(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        "Cache returned null, using fallback",
        expect.any(Object),
      );
    });
  });

  describe("Circuit Breaker Activation", () => {
    it("should open circuit breaker after 5 consecutive failures", async () => {
      (cacheService.increment as jest.Mock).mockRejectedValue(
        new Error("Connection refused"),
      );

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
        (cacheService.increment as jest.Mock).mockRejectedValueOnce(
          new Error("Cache down"),
        );
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
      await apiKeyRateLimiter(mockReq, mockRes, mockNext);

      // Should NOT call cache (circuit is OPEN)
      expect(cacheService.increment).not.toHaveBeenCalled();
      // Should use fallback instead
      expect(mockNext).toHaveBeenCalled();
    });

    it("should remain OPEN during cooldown period", async () => {
      (cacheService.increment as jest.Mock).mockRejectedValue(
        new Error("Cache down"),
      );

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
      (cacheService.increment as jest.Mock).mockRejectedValue(
        new Error("Cache down"),
      );

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
      (cacheService.increment as jest.Mock).mockRejectedValue(
        new Error("Cache down"),
      );

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
      (cacheService.increment as jest.Mock).mockRejectedValue(
        new Error("Cache down"),
      );

      for (let i = 0; i < 5; i++) {
        await apiKeyRateLimiter(mockReq, mockRes, mockNext);
      }

      // Fast-forward to HALF_OPEN
      jest.useFakeTimers();
      jest.advanceTimersByTime(61_000);

      expect(circuitBreaker.getState()).toBe("HALF_OPEN");

      // Simulate another failure
      (cacheService.increment as jest.Mock).mockRejectedValueOnce(
        new Error("Still down"),
      );

      await apiKeyRateLimiter(mockReq, mockRes, mockNext);

      // Should immediately reopen
      expect(circuitBreaker.getState()).toBe("OPEN");

      jest.useRealTimers();
    });
  });

  describe("Multiple IPs Isolation", () => {
    it("should handle multiple IPs independently in fallback mode", async () => {
      (cacheService.increment as jest.Mock).mockRejectedValue(
        new Error("Cache down"),
      );

      const ip1Req = { ...mockReq, ip: "10.0.0.1" };
      const ip2Req = { ...mockReq, ip: "10.0.0.2" };

      const ip1Res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const ip2Res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      const ip1Next = jest.fn();
      const ip2Next = jest.fn();

      // Send 20 requests from IP1 - should all pass
      for (let i = 0; i < 20; i++) {
        await apiKeyRateLimiter(ip1Req, ip1Res, ip1Next);
      }

      // Send 20 requests from IP2 - should all pass
      for (let i = 0; i < 20; i++) {
        await apiKeyRateLimiter(ip2Req, ip2Res, ip2Next);
      }

      expect(ip1Next).toHaveBeenCalledTimes(20);
      expect(ip2Next).toHaveBeenCalledTimes(20);

      // Send 1 more from IP1 - should be rejected (21st)
      await apiKeyRateLimiter(ip1Req, ip1Res, ip1Next);
      expect(ip1Res.status).toHaveBeenCalledWith(429);

      // IP2 should still have its own counter (not affected by IP1)
      expect(ip2Res.status).not.toHaveBeenCalled();
    });
  });

  describe("Security Tests", () => {
    it("should handle missing IP gracefully", async () => {
      (cacheService.increment as jest.Mock).mockRejectedValue(
        new Error("Cache down"),
      );

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
      (cacheService.increment as jest.Mock).mockRejectedValue(
        new Error("Cache down"),
      );

      const malformedReq = {
        ip: null,
        apiKey: null,
      };

      // Should pass through if no API key (different middleware handles this)
      await apiKeyRateLimiter(malformedReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe("Memory Leak Prevention", () => {
    it("should cleanup expired fallback entries", async () => {
      jest.useFakeTimers();

      // Manually add expired entries
      const { fallbackRateLimitStore } = require("./rateLimiter");
      const now = Date.now();
      fallbackRateLimitStore.set("expired:key:1", {
        count: 5,
        expiresAt: now - 10000, // Expired 10 seconds ago
      });
      fallbackRateLimitStore.set("valid:key:1", {
        count: 3,
        expiresAt: now + 60000, // Valid for 60 seconds
      });

      expect(fallbackRateLimitStore.size).toBe(2);

      // Advance time by 5 minutes (cleanup interval)
      jest.advanceTimersByTime(5 * 60 * 1000);

      // Expired entry should be cleaned up
      expect(fallbackRateLimitStore.has("expired:key:1")).toBe(false);
      expect(fallbackRateLimitStore.has("valid:key:1")).toBe(true);

      jest.useRealTimers();
    });
  });

  describe("Metrics Emission", () => {
    it("should emit metrics during fallback activation", async () => {
      (cacheService.increment as jest.Mock).mockRejectedValue(
        new Error("Cache down"),
      );

      await apiKeyRateLimiter(mockReq, mockRes, mockNext);

      expect(fallbackMetrics.failuresTotal).toBeGreaterThan(0);
      expect(fallbackMetrics.fallbackActivations).toBeGreaterThan(0);
      expect(fallbackMetrics.lastFailureAt).not.toBeNull();
    });

    it("should increment rejectionsInFallback when limit exceeded", async () => {
      (cacheService.increment as jest.Mock).mockRejectedValue(
        new Error("Cache down"),
      );

      // Exceed fallback limit
      for (let i = 0; i < 25; i++) {
        await apiKeyRateLimiter(mockReq, mockRes, mockNext);
      }

      expect(fallbackMetrics.rejectionsInFallback).toBeGreaterThan(0);
    });

    it("should log warning when circuit breaker is OPEN", async () => {
      // Open circuit
      (cacheService.increment as jest.Mock).mockRejectedValue(
        new Error("Cache down"),
      );

      for (let i = 0; i < 5; i++) {
        await apiKeyRateLimiter(mockReq, mockRes, mockNext);
      }

      // Clear mocks
      logger.warn.mockClear();

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
      (cacheService.increment as jest.Mock).mockRejectedValue(
        new Error("Connection timeout"),
      );

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
      const { injectFallbackState } = require("./rateLimiter");

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
});
