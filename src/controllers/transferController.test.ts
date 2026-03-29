import {
  postTransfers,
  getTransfers,
  getTransferById,
} from "./transferController";
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

const makeRes = () => {
  const res = { status: jest.fn(), json: jest.fn() } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  (res.json as jest.Mock).mockReturnValue(res);
  return res;
};

const makeNext = () => jest.fn() as jest.MockedFunction<NextFunction>;

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
      await postTransfers(
        { body: {} } as unknown as AuthRequest,
        makeRes(),
        next,
      );
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
      await postTransfers(
        {
          body: { to: "@bob", amount_acbu: "10.5" },
          apiKey: { userId: "u1" },
        } as unknown as AuthRequest,
        res,
        makeNext(),
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        transaction_id: "tx-1",
        status: "pending",
      });
    });

    it("returns 404 when recipient is not found", async () => {
      (createTransfer as jest.Mock).mockRejectedValue(
        new Error("Recipient not found or not available"),
      );
      const next = makeNext();
      await postTransfers(
        {
          body: { to: "@nobody", amount_acbu: "10" },
          apiKey: { userId: "u1" },
        } as unknown as AuthRequest,
        makeRes(),
        next,
      );
      expect((next as jest.Mock).mock.calls[0][0]).toMatchObject({
        statusCode: 404,
      });
    });

    it("returns 404 when sender user record is missing", async () => {
      (createTransfer as jest.Mock).mockRejectedValue(
        new Error("Sender user not found"),
      );
      const next = makeNext();
      await postTransfers(
        {
          body: { to: "@bob", amount_acbu: "10" },
          apiKey: { userId: "ghost" },
        } as unknown as AuthRequest,
        makeRes(),
        next,
      );
      expect((next as jest.Mock).mock.calls[0][0]).toMatchObject({
        statusCode: 404,
      });
    });

    it("returns 403 when sender KYC is not verified", async () => {
      (createTransfer as jest.Mock).mockRejectedValue(
        new Error(
          "KYC required to make payments. Complete verification first.",
        ),
      );
      const next = makeNext();
      await postTransfers(
        {
          body: { to: "@bob", amount_acbu: "10" },
          apiKey: { userId: "u1" },
        } as unknown as AuthRequest,
        makeRes(),
        next,
      );
      expect((next as jest.Mock).mock.calls[0][0]).toMatchObject({
        statusCode: 403,
      });
    });

    it("returns 400 on self-transfer attempt", async () => {
      (createTransfer as jest.Mock).mockRejectedValue(
        new Error("Cannot transfer to yourself"),
      );
      const next = makeNext();
      await postTransfers(
        {
          body: { to: "@self", amount_acbu: "10" },
          apiKey: { userId: "u1" },
        } as unknown as AuthRequest,
        makeRes(),
        next,
      );
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
      expect(body.next_cursor).toBe("tx-1"); // last id of first page
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
