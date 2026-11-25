/**
 * Tests for JTI deny-list Redis fallback behavior (W11-AUD-007).
 *
 * When Redis is unavailable the deny-list degrades to an in-process Map so
 * that 2FA challenge tokens can still be validated on the current instance.
 * This prevents a Redis outage from locking all users out while still
 * blocking replay attacks within the same process.
 */

jest.mock("../src/services/cache", () => ({
  redisService: {
    setNx: jest.fn(),
    set: jest.fn(),
    get: jest.fn(),
  },
}));

jest.mock("../src/config/logger", () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { consumeJti, revokeJti, isJtiRevoked } from "../src/utils/jtiDenyList";
import { redisService } from "../src/services/cache";
import { logger } from "../src/config/logger";

const mockedRedis = redisService as jest.Mocked<typeof redisService>;
const mockedLogger = logger as jest.Mocked<typeof logger>;

const futureExp = Math.floor(Date.now() / 1000) + 300;

function uniqueJti(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("W11-AUD-007 — JTI deny-list Redis fallback", () => {
  describe("consumeJti with Redis available", () => {
    it("returns true on first use when Redis setNx succeeds", async () => {
      mockedRedis.setNx.mockResolvedValueOnce(true);
      const result = await consumeJti(uniqueJti("redis-ok"), futureExp);
      expect(result).toBe(true);
      expect(mockedRedis.setNx).toHaveBeenCalledTimes(1);
    });

    it("returns false when Redis reports the key already exists (replay blocked)", async () => {
      mockedRedis.setNx.mockResolvedValueOnce(false);
      const result = await consumeJti(uniqueJti("redis-exists"), futureExp);
      expect(result).toBe(false);
    });
  });

  describe("consumeJti with Redis unavailable", () => {
    it("falls back to in-process deny-list when Redis throws", async () => {
      mockedRedis.setNx.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await consumeJti(uniqueJti("fallback-first"), futureExp);

      expect(result).toBe(true);
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("in-process fallback"),
        expect.objectContaining({ redisUnavailable: true, fallbackMode: "local" }),
      );
    });

    it("blocks replay within the same process even when Redis is down", async () => {
      mockedRedis.setNx
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const jti = uniqueJti("replay-fallback");

      const first = await consumeJti(jti, futureExp);
      const second = await consumeJti(jti, futureExp);

      expect(first).toBe(true);
      // In-process deny-list must catch the second attempt even without Redis.
      expect(second).toBe(false);
    });

    it("does not throw when Redis times out", async () => {
      mockedRedis.setNx.mockRejectedValueOnce(new Error("Redis SET NX timed out after 1000ms"));

      await expect(consumeJti(uniqueJti("timeout"), futureExp)).resolves.toBe(true);
    });
  });

  describe("revokeJti with Redis unavailable", () => {
    it("does not throw when Redis write fails", async () => {
      mockedRedis.set.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await expect(revokeJti(uniqueJti("revoke-nothrow"), futureExp)).resolves.not.toThrow();
      expect(mockedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("in-process fallback"),
        expect.objectContaining({ redisUnavailable: true, fallbackMode: "local" }),
      );
    });

    it("adds the JTI to the in-process list even when Redis is down", async () => {
      mockedRedis.set.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      // Redis GET also unavailable so only the local list is consulted.
      mockedRedis.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const jti = uniqueJti("revoke-local");
      await revokeJti(jti, futureExp);

      const revoked = await isJtiRevoked(jti);
      expect(revoked).toBe(true);
    });
  });

  describe("isJtiRevoked with Redis unavailable", () => {
    it("returns false when Redis GET fails and JTI is not in local list", async () => {
      mockedRedis.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await isJtiRevoked(uniqueJti("unknown"));
      expect(result).toBe(false);
    });

    it("returns true for a locally-revoked JTI even when Redis is unreachable", async () => {
      mockedRedis.set.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      mockedRedis.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const jti = uniqueJti("local-revoked");
      await revokeJti(jti, futureExp);

      const revoked = await isJtiRevoked(jti);
      expect(revoked).toBe(true);
    });
  });
});
