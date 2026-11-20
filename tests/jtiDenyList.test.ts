/**
 * Tests for the cross-instance JTI deny-list (W10-BE-018 / #1201).
 *
 * The original implementation (#288) used an in-process Map that only
 * protected a single Node.js process. In a multi-instance deployment, a
 * stolen 2FA challenge token could be replayed against a different instance
 * within its 5-minute window.
 *
 * Fix (#984): deny-list entries are now written to Redis with `SET NX` so
 * every instance rejects a previously-consumed JTI. An in-process mirror
 * serves as a fallback when Redis is unreachable.
 *
 * These tests verify:
 * 1. Redis SET NX semantics — first caller wins, second is rejected.
 * 2. Redis-first path — result comes from Redis, not the local Map alone.
 * 3. In-process fallback — Redis failure degrades to single-instance safety.
 * 4. isJtiRevoked reads Redis for cross-instance awareness.
 * 5. revokeJti writes to both Redis and the local mirror.
 * 6. TTL is derived from the token's exp claim so Redis auto-expires entries.
 */

jest.mock("dotenv", () => ({ config: jest.fn() }));

// ---------------------------------------------------------------------------
// Shared Redis mock — preserves SET NX atomicity semantics
// ---------------------------------------------------------------------------
const redisStore = new Map<string, string>();

const mockRedis = {
  get: jest.fn(async (key: string) => (redisStore.has(key) ? "1" : null)),
  set: jest.fn(async (key: string) => {
    redisStore.set(key, "1");
    return "OK";
  }),
  setNx: jest.fn(async (key: string) => {
    if (redisStore.has(key)) return false;
    redisStore.set(key, "1");
    return true;
  }),
};

jest.mock("../src/services/cache", () => ({ redisService: mockRedis }));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import { consumeJti, isJtiRevoked, revokeJti } from "../src/utils/jtiDenyList";

describe("jtiDenyList — cross-instance Redis deny-list (W10-BE-018 / #1201)", () => {
  const expFuture = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now

  beforeEach(() => {
    redisStore.clear();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // consumeJti — atomic SET NX claim
  // -------------------------------------------------------------------------
  describe("consumeJti", () => {
    it("returns true on first use and writes to Redis (cross-instance guard)", async () => {
      const jti = "jti-first-claim";
      const result = await consumeJti(jti, expFuture);

      expect(result).toBe(true);
      // Redis SET NX was called — this is what makes the claim cross-instance
      expect(mockRedis.setNx).toHaveBeenCalledWith(
        expect.stringContaining(jti),
        "1",
        expect.any(Number),
      );
      // Key is now present in the shared store
      expect(redisStore.has(`jwt:jti:revoked:${jti}`)).toBe(true);
    });

    it("returns false on second use — replay rejected (same instance)", async () => {
      const jti = "jti-replay-same";
      await consumeJti(jti, expFuture); // first use
      const replay = await consumeJti(jti, expFuture); // replay

      expect(replay).toBe(false);
    });

    it("returns false when Redis already holds the JTI (cross-instance replay)", async () => {
      const jti = "jti-cross-instance-replay";
      // Simulate another instance having consumed this JTI first
      redisStore.set(`jwt:jti:revoked:${jti}`, "1");

      const result = await consumeJti(jti, expFuture);

      expect(result).toBe(false);
      expect(mockRedis.setNx).toHaveBeenCalledTimes(1);
    });

    it("falls back to in-process protection when Redis SET NX throws", async () => {
      const jti = "jti-redis-down-consume";
      mockRedis.setNx.mockRejectedValueOnce(new Error("Redis unreachable"));

      // Should still succeed on first call despite Redis failure
      const first = await consumeJti(jti, expFuture);
      expect(first).toBe(true);

      // Second call uses in-process mirror — replay is still rejected
      mockRedis.setNx.mockRejectedValueOnce(new Error("Redis unreachable"));
      const second = await consumeJti(jti, expFuture);
      expect(second).toBe(false);
    });

    it("passes a TTL derived from exp claim so Redis auto-expires the entry", async () => {
      const exp = Math.floor(Date.now() / 1000) + 120; // 2 minutes
      await consumeJti("jti-ttl-check", exp);

      const [, , ttl] = mockRedis.setNx.mock.calls[0] as [string, string, number];
      // TTL should be ~120 seconds (allow ±2s for timing)
      expect(ttl).toBeGreaterThanOrEqual(118);
      expect(ttl).toBeLessThanOrEqual(122);
    });
  });

  // -------------------------------------------------------------------------
  // isJtiRevoked — read-only cross-instance check
  // -------------------------------------------------------------------------
  describe("isJtiRevoked", () => {
    it("returns false for an unseen JTI", async () => {
      const result = await isJtiRevoked("jti-unseen");
      expect(result).toBe(false);
    });

    it("returns true when the JTI was consumed by this instance", async () => {
      const jti = "jti-local-consumed";
      await consumeJti(jti, expFuture);
      const revoked = await isJtiRevoked(jti);
      expect(revoked).toBe(true);
    });

    it("returns true when another instance consumed the JTI (Redis read)", async () => {
      const jti = "jti-remote-consumed";
      // Populate Redis directly — simulates another instance's consumeJti call
      redisStore.set(`jwt:jti:revoked:${jti}`, "1");

      const result = await isJtiRevoked(jti);

      expect(result).toBe(true);
      expect(mockRedis.get).toHaveBeenCalledWith(expect.stringContaining(jti));
    });

    it("falls back to in-process mirror when Redis GET throws", async () => {
      const jti = "jti-redis-down-read";
      await consumeJti(jti, expFuture); // populates local mirror
      mockRedis.get.mockRejectedValueOnce(new Error("Redis connection lost"));

      // Should still return true from in-process mirror
      const result = await isJtiRevoked(jti);
      expect(result).toBe(true);
    });

    it("returns false when Redis fails and JTI is not in local mirror", async () => {
      mockRedis.get.mockRejectedValueOnce(new Error("Redis connection lost"));
      const result = await isJtiRevoked("jti-not-local");
      // Fails open in this degraded state — consistent with original single-instance behaviour
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // revokeJti — explicit revocation (without consume)
  // -------------------------------------------------------------------------
  describe("revokeJti", () => {
    it("writes to Redis so sibling instances observe the revocation", async () => {
      const jti = "jti-explicit-revoke";
      await revokeJti(jti, expFuture);

      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining(jti),
        "1",
        expect.any(Number),
      );
      expect(redisStore.has(`jwt:jti:revoked:${jti}`)).toBe(true);
    });

    it("after revokeJti, isJtiRevoked returns true", async () => {
      const jti = "jti-after-revoke";
      await revokeJti(jti, expFuture);
      const revoked = await isJtiRevoked(jti);
      expect(revoked).toBe(true);
    });

    it("after revokeJti, consumeJti returns false (already revoked)", async () => {
      const jti = "jti-revoked-then-consume";
      await revokeJti(jti, expFuture);
      const result = await consumeJti(jti, expFuture);
      expect(result).toBe(false);
    });

    it("does not throw when Redis SET fails — logs warning and keeps local mirror", async () => {
      mockRedis.set.mockRejectedValueOnce(new Error("Redis write failed"));
      const jti = "jti-redis-set-fail";

      // Should not throw
      await expect(revokeJti(jti, expFuture)).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Key format
  // -------------------------------------------------------------------------
  it("uses a namespaced Redis key to avoid collisions with other data", async () => {
    await consumeJti("jti-key-format", expFuture);

    const calledKey = mockRedis.setNx.mock.calls[0][0] as string;
    expect(calledKey).toBe("jwt:jti:revoked:jti-key-format");
  });
});
