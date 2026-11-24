/**
 * Unit tests for services/idempotency/idempotencyStore.ts
 *
 * Verifies:
 *  1. acquireIdempotencyKey returns null and inserts a "pending" placeholder on
 *     first call (atomic findOneAndUpdate with $setOnInsert).
 *  2. acquireIdempotencyKey returns the cached result on a repeat call once the
 *     key has been resolved.
 *  3. acquireIdempotencyKey returns null (not the cached result) when the key is
 *     still "pending" (concurrent in-flight request).
 *  4. acquireIdempotencyKey propagates errors — it does NOT return null when the
 *     datastore is unavailable (fail-safe, not fail-open).
 *  5. resolveIdempotencyKey updates the document to "resolved" with the result.
 *  6. resolveIdempotencyKey propagates errors instead of silently swallowing them.
 */

const findOneAndUpdateMock = jest.fn();
const updateOneMock = jest.fn();
const createIndexMock = jest.fn();

const collectionMock = jest.fn().mockReturnValue({
  findOneAndUpdate: findOneAndUpdateMock,
  updateOne: updateOneMock,
  createIndex: createIndexMock,
});

jest.mock("../src/config/mongodb", () => ({
  getMongoDB: jest.fn().mockReturnValue({ collection: collectionMock }),
}));

jest.mock("../src/config/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import {
  acquireIdempotencyKey,
  resolveIdempotencyKey,
  ensureIdempotencyIndex,
} from "../src/services/idempotency/idempotencyStore";
import { logger } from "../src/config/logger";

describe("idempotencyStore", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── acquireIdempotencyKey ────────────────────────────────────────────────

  describe("acquireIdempotencyKey", () => {
    it("returns null and inserts a pending placeholder on first request", async () => {
      // findOneAndUpdate returns null when no document existed before the upsert
      findOneAndUpdateMock.mockResolvedValueOnce(null);

      const result = await acquireIdempotencyKey("key-1");

      expect(result).toBeNull();

      // Must use a single atomic findOneAndUpdate — no separate findOne
      expect(findOneAndUpdateMock).toHaveBeenCalledTimes(1);
      expect(findOneAndUpdateMock).toHaveBeenCalledWith(
        { key: "key-1" },
        expect.objectContaining({
          $setOnInsert: expect.objectContaining({ key: "key-1", status: "pending" }),
        }),
        { upsert: true, returnDocument: "before" },
      );
    });

    it("returns the cached result when the key is already resolved", async () => {
      const cachedResult = { transaction_id: "tx-abc", status: "completed" };
      findOneAndUpdateMock.mockResolvedValueOnce({
        key: "key-2",
        status: "resolved",
        result: cachedResult,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      });

      const result = await acquireIdempotencyKey<typeof cachedResult>("key-2");

      expect(result).toEqual(cachedResult);
      expect(findOneAndUpdateMock).toHaveBeenCalledTimes(1);
    });

    it("returns null when the key is pending (concurrent in-flight request)", async () => {
      findOneAndUpdateMock.mockResolvedValueOnce({
        key: "key-3",
        status: "pending",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      });

      const result = await acquireIdempotencyKey("key-3");

      // Still returns null — caller must handle the race condition
      expect(result).toBeNull();
      expect(findOneAndUpdateMock).toHaveBeenCalledTimes(1);
    });

    it("propagates datastore errors instead of failing open", async () => {
      // This is the core fix: old code returned null on error (= "treat as first
      // request").  New code must throw so the caller knows the check failed.
      const dbError = new Error("MongoDB connection timeout");
      findOneAndUpdateMock.mockRejectedValueOnce(dbError);

      await expect(acquireIdempotencyKey("key-4")).rejects.toThrow("MongoDB connection timeout");

      expect(findOneAndUpdateMock).toHaveBeenCalledTimes(1);
    });

    it("respects a custom TTL when building the expiresAt timestamp", async () => {
      findOneAndUpdateMock.mockResolvedValueOnce(null);

      const ttl = 3600; // 1 hour
      const before = Date.now();
      await acquireIdempotencyKey("key-5", ttl);
      const after = Date.now();

      const call = findOneAndUpdateMock.mock.calls[0];
      const insertedExpiresAt: Date = call[1].$setOnInsert.expiresAt;

      // expiresAt should be roughly ttl seconds from now
      expect(insertedExpiresAt.getTime()).toBeGreaterThanOrEqual(before + ttl * 1000 - 50);
      expect(insertedExpiresAt.getTime()).toBeLessThanOrEqual(after + ttl * 1000 + 50);
    });
  });

  // ─── resolveIdempotencyKey ────────────────────────────────────────────────

  describe("resolveIdempotencyKey", () => {
    it("marks the document as resolved with the provided result", async () => {
      updateOneMock.mockResolvedValueOnce({ modifiedCount: 1 });

      const payload = { transaction_id: "tx-xyz", amount: "10.0" };
      await resolveIdempotencyKey("key-6", payload);

      expect(updateOneMock).toHaveBeenCalledTimes(1);
      expect(updateOneMock).toHaveBeenCalledWith(
        { key: "key-6" },
        expect.objectContaining({
          $set: expect.objectContaining({ status: "resolved", result: payload }),
        }),
        { upsert: true },
      );
    });

    it("propagates datastore errors instead of silently swallowing them", async () => {
      const dbError = new Error("MongoDB write concern timeout");
      updateOneMock.mockRejectedValueOnce(dbError);

      await expect(resolveIdempotencyKey("key-7", { ok: true })).rejects.toThrow("MongoDB write concern timeout");

      expect(updateOneMock).toHaveBeenCalledTimes(1);
    });
  });

  // ─── ensureIdempotencyIndex ───────────────────────────────────────────────

  describe("ensureIdempotencyIndex", () => {
    it("creates TTL and unique indexes without throwing", async () => {
      createIndexMock.mockResolvedValue("index_name");

      await expect(ensureIdempotencyIndex()).resolves.toBeUndefined();
      expect(createIndexMock).toHaveBeenCalledTimes(2);
    });

    it("logs a warning instead of throwing when index creation fails", async () => {
      createIndexMock.mockRejectedValueOnce(new Error("index already exists"));

      // Must not throw — startup should not be blocked by this
      await expect(ensureIdempotencyIndex()).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        "Failed to create idempotency indexes",
        expect.objectContaining({ err: expect.any(Error) }),
      );
    });
  });
});
