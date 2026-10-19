import { postTransfers, getTransfers, getTransferById } from "./transferController";
import { prisma } from "../config/database";
import type { AuthRequest } from "../middleware/auth";
import type { Response, NextFunction } from "express";

jest.mock("../services/transfer/transferService", () => ({
  createTransfer: jest.fn(),
}));

jest.mock("../config/database", () => ({
  prisma: {
    transaction: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

jest.mock("../config/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { createTransfer } from "../services/transfer/transferService";
import { StellarFeeSurgeError } from "../errors";
import { AppError } from "../middleware/errorHandler";
import { decodeCursor } from "../middleware/pagination";

const makeRes = () => {
  const res = { status: jest.fn(), json: jest.fn() } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  (res.json as jest.Mock).mockReturnValue(res);
  return res;
};

const makeNext = () => jest.fn() as jest.MockedFunction<NextFunction>;

/**
 * Build a fake AuthRequest.
 *
 * Express's `Request` always provides `header()` and `get()`, and the transfer
 * endpoints read both (`getIfMatchHeader` calls `req.header`,
 * `extractIdempotencyKey` prefers `req.get`). Hand-rolled request literals that
 * omit them die with `TypeError: req.header is not a function` before reaching
 * the code under test, so provide sensible defaults and let callers override.
 */
const makeReq = (
  overrides: {
    body?: unknown;
    query?: unknown;
    apiKey?: { userId: string | null } | undefined;
    /** Overrides the default `get()` used by extractIdempotencyKey. */
    get?: jest.Mock;
    /** Overrides the default `header()` used by getIfMatchHeader. */
    header?: jest.Mock;
  } = {},
): AuthRequest =>
  ({
    body: {},
    query: {},
    apiKey: { userId: "u1" },
    headers: {},
    ...overrides,
    header: overrides.header ?? jest.fn().mockReturnValue(undefined),
    get: overrides.get ?? jest.fn().mockReturnValue(undefined),
  }) as unknown as AuthRequest;

describe("transferController", () => {
  beforeEach(() => jest.clearAllMocks());

  // ── postTransfers ──────────────────────────────────────────────────────────

  describe("postTransfers", () => {
    it("returns 401 when request has no userId (org-only key)", async () => {
      const next = makeNext();
      await postTransfers(
        { body: {}, apiKey: { userId: null } } as unknown as AuthRequest,
        makeRes(),
        next,
      );
      expect((next as jest.Mock).mock.calls[0][0]).toMatchObject({
        statusCode: 401,
      });
    });

    it("returns 401 when apiKey is absent entirely", async () => {
      const next = makeNext();
      await postTransfers({ body: {} } as unknown as AuthRequest, makeRes(), next);
      expect((next as jest.Mock).mock.calls[0][0]).toMatchObject({
        statusCode: 401,
      });
    });

    it("returns 400 when amount_acbu is not a valid number", async () => {
      const next = makeNext();
      await postTransfers(
        {
          body: { to: "@bob", amount_acbu: "not-a-number" },
          apiKey: { userId: "u1" },
        } as unknown as AuthRequest,
        makeRes(),
        next,
      );
      expect((next as jest.Mock).mock.calls[0][0]).toMatchObject({
        statusCode: 400,
      });
    });

    it("returns 400 when amount_acbu is zero", async () => {
      const next = makeNext();
      await postTransfers(
        {
          body: { to: "@bob", amount_acbu: "0" },
          apiKey: { userId: "u1" },
        } as unknown as AuthRequest,
        makeRes(),
        next,
      );
      expect((next as jest.Mock).mock.calls[0][0]).toMatchObject({
        statusCode: 400,
      });
    });

    it("returns 400 when amount_acbu has too many decimal places (>7)", async () => {
      const next = makeNext();
      await postTransfers(
        {
          body: { to: "@bob", amount_acbu: "1.12345678" },
          apiKey: { userId: "u1" },
        } as unknown as AuthRequest,
        makeRes(),
        next,
      );
      expect((next as jest.Mock).mock.calls[0][0]).toMatchObject({
        statusCode: 400,
      });
    });

    it("returns 201 with transaction_id and status on success", async () => {
      (createTransfer as jest.Mock).mockResolvedValue({
        transactionId: "tx-1",
        status: "pending",
      });
      const res = makeRes();
      await postTransfers(makeReq({ body: { to: "@bob", amount_acbu: "10.5" } }), res, makeNext());
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        transaction_id: "tx-1",
        status: "pending",
      });
    });

    it("forwards a fee surge as a retryable 503 rather than a 500 (AB-052)", async () => {
      // createTransfer rethrows StellarFeeSurgeError after marking the row
      // failed. It must reach the error handler as an AppError so the client
      // gets 503 + STELLAR_FEE_SURGE and knows to retry, not a 500.
      (createTransfer as jest.Mock).mockRejectedValue(
        new StellarFeeSurgeError({
          networkFeeStroops: 2_000_000,
          transactionFeeStroops: 1_000_000,
          maxFeeStroops: 1_000_000,
          detectedBy: "fee_pricing",
        }),
      );
      const res = makeRes();
      const next = makeNext();
      await postTransfers(makeReq({ body: { to: "@bob", amount_acbu: "10" } }), res, next);

      // Nothing was written to the success path.
      expect(res.status).not.toHaveBeenCalled();
      const forwarded = (next as jest.Mock).mock.calls[0][0];
      expect(forwarded).toBeInstanceOf(AppError);
      expect(forwarded).toMatchObject({ statusCode: 503, code: "STELLAR_FEE_SURGE" });
      expect((forwarded as StellarFeeSurgeError).networkFeeStroops).toBe(2_000_000);
    });

    it("passes the Idempotency-Key header into transfer creation", async () => {
      (createTransfer as jest.Mock).mockResolvedValue({
        transactionId: "tx-2",
        status: "completed",
      });
      const res = makeRes();
      await postTransfers(
        makeReq({
          body: { to: "@bob", amount_acbu: "10.5" },
          get: jest.fn().mockReturnValue("idem-transfer"),
        }),
        res,
        makeNext(),
      );
      expect(createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          senderUserId: "u1",
          to: "@bob",
          amountAcbu: "10.5",
          idempotencyKey: "idem-transfer",
        }),
        expect.any(Object),
      );
    });

    it("returns 404 when recipient is not found", async () => {
      (createTransfer as jest.Mock).mockRejectedValue(
        new Error("Recipient not found or not available"),
      );
      const next = makeNext();
      await postTransfers(makeReq({ body: { to: "@nobody", amount_acbu: "10" } }), makeRes(), next);
      expect((next as jest.Mock).mock.calls[0][0]).toMatchObject({
        statusCode: 404,
      });
    });

    it("returns 404 when sender user record is missing", async () => {
      (createTransfer as jest.Mock).mockRejectedValue(new Error("Sender user not found"));
      const next = makeNext();
      await postTransfers(
        makeReq({ body: { to: "@bob", amount_acbu: "10" }, apiKey: { userId: "ghost" } }),
        makeRes(),
        next,
      );
      expect((next as jest.Mock).mock.calls[0][0]).toMatchObject({
        statusCode: 404,
      });
    });

    it("returns 400 on self-transfer attempt", async () => {
      (createTransfer as jest.Mock).mockRejectedValue(new Error("Cannot transfer to yourself"));
      const next = makeNext();
      await postTransfers(makeReq({ body: { to: "@self", amount_acbu: "10" } }), makeRes(), next);
      expect((next as jest.Mock).mock.calls[0][0]).toMatchObject({
        statusCode: 400,
      });
    });
  });

  // ── getTransfers ───────────────────────────────────────────────────────────

  describe("getTransfers", () => {
    it("returns 401 when no userId in API key", async () => {
      const next = makeNext();
      await getTransfers(
        { query: {}, apiKey: { userId: null } } as unknown as AuthRequest,
        makeRes(),
        next,
      );
      expect((next as jest.Mock).mock.calls[0][0]).toMatchObject({
        statusCode: 401,
      });
    });

    it("returns transfers list with next_cursor null when result fits in page", async () => {
      const now = new Date();
      (prisma.transaction.findMany as jest.Mock).mockResolvedValue([
        {
          id: "tx-1",
          status: "completed",
          acbuAmount: { toString: () => "10" },
          blockchainTxHash: "h1",
          createdAt: now,
          completedAt: now,
        },
      ]);
      const res = makeRes();
      await getTransfers(
        {
          query: { limit: "20" },
          apiKey: { userId: "u1" },
        } as unknown as AuthRequest,
        res,
        makeNext(),
      );
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.next_cursor).toBeNull();
      expect(body.transfers).toHaveLength(1);
      expect(body.transfers[0]).toMatchObject({
        transaction_id: "tx-1",
        status: "completed",
        amount_acbu: "10",
      });
    });

    it("returns next_cursor when there are more results than the requested limit", async () => {
      const now = new Date();
      // Return limit+1 items (3 when limit=2) to signal there is a next page
      const rows = Array.from({ length: 3 }, (_, i) => ({
        id: `tx-${i}`,
        status: "pending",
        acbuAmount: null,
        blockchainTxHash: null,
        createdAt: now,
        completedAt: null,
      }));
      (prisma.transaction.findMany as jest.Mock).mockResolvedValue(rows);
      const res = makeRes();
      await getTransfers(
        {
          query: { limit: "2" },
          apiKey: { userId: "u1" },
        } as unknown as AuthRequest,
        res,
        makeNext(),
      );
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.transfers).toHaveLength(2);
      // next_cursor is an opaque, scope-bound cursor, not a raw id (#405).
      // Round-trip it instead of hardcoding the encoded value, so this stays
      // correct if the cursor payload or signing changes, and so it actually
      // verifies the cursor is bound to this user.
      expect(body.next_cursor).not.toBe("tx-1");
      expect(decodeCursor(body.next_cursor, "u1")).toBe("tx-1");
      // Another user's scope must not decode it.
      expect(() => decodeCursor(body.next_cursor, "someone-else")).toThrow(AppError);
    });

    it("returns 400 when limit exceeds maximum (100)", async () => {
      const next = makeNext();
      await getTransfers(
        {
          query: { limit: "200" },
          apiKey: { userId: "u1" },
        } as unknown as AuthRequest,
        makeRes(),
        next,
      );
      expect((next as jest.Mock).mock.calls[0][0]).toMatchObject({
        statusCode: 400,
      });
    });

    it("handles null acbuAmount gracefully (returns null amount_acbu)", async () => {
      const now = new Date();
      (prisma.transaction.findMany as jest.Mock).mockResolvedValue([
        {
          id: "tx-x",
          status: "pending",
          acbuAmount: null,
          blockchainTxHash: null,
          createdAt: now,
          completedAt: null,
        },
      ]);
      const res = makeRes();
      await getTransfers(
        { query: {}, apiKey: { userId: "u1" } } as unknown as AuthRequest,
        res,
        makeNext(),
      );
      const body = (res.json as jest.Mock).mock.calls[0][0];
      expect(body.transfers[0].amount_acbu).toBeNull();
    });
  });

  // ── getTransferById ────────────────────────────────────────────────────────

  describe("getTransferById", () => {
    it("returns 401 when no userId in API key", async () => {
      const next = makeNext();
      await getTransferById(
        {
          params: { id: "tx-1" },
          apiKey: { userId: null },
        } as unknown as AuthRequest,
        makeRes(),
        next,
      );
      expect((next as jest.Mock).mock.calls[0][0]).toMatchObject({
        statusCode: 401,
      });
    });

    it("returns 404 when transfer is not found", async () => {
      (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);
      const next = makeNext();
      await getTransferById(
        {
          params: { id: "tx-missing" },
          apiKey: { userId: "u1" },
        } as unknown as AuthRequest,
        makeRes(),
        next,
      );
      expect((next as jest.Mock).mock.calls[0][0]).toMatchObject({
        statusCode: 404,
      });
    });

    it("returns transfer details when found", async () => {
      const now = new Date();
      (prisma.transaction.findFirst as jest.Mock).mockResolvedValue({
        id: "tx-1",
        status: "completed",
        acbuAmount: { toString: () => "25.5" },
        blockchainTxHash: "hash-abc",
        createdAt: now,
        completedAt: now,
      });
      const res = makeRes();
      await getTransferById(
        {
          params: { id: "tx-1" },
          apiKey: { userId: "u1" },
        } as unknown as AuthRequest,
        res,
        makeNext(),
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction_id: "tx-1",
          status: "completed",
          amount_acbu: "25.5",
          blockchain_tx_hash: "hash-abc",
        }),
      );
    });

    it("scopes lookup to the requesting user (passes userId to query)", async () => {
      (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);
      await getTransferById(
        {
          params: { id: "tx-1" },
          apiKey: { userId: "u99" },
        } as unknown as AuthRequest,
        makeRes(),
        makeNext(),
      );
      expect(prisma.transaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "u99", id: "tx-1" }),
        }),
      );
    });
  });
});
