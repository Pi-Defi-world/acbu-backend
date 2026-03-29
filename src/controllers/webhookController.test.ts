/**
 * Webhook controller tests.
 * env is mocked with known secrets so we can compute expected HMACs deterministically.
 */
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

const FW_SECRET = "test-flutterwave-secret";
const PS_SECRET = "test-paystack-secret";

jest.mock("../config/env", () => ({
  config: {
    flutterwave: { webhookSecret: FW_SECRET },
    paystack: { secretKey: PS_SECRET },
  },
}));

jest.mock("../config/logger", () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock("../config/database", () => ({
  prisma: {
    webhook: { create: jest.fn() },
  },
}));

import {
  verifyFlutterwaveSignature,
  verifyPaystackSignature,
  handleFlutterwaveWebhook,
  handlePaystackWebhook,
} from "./webhookController";
import { prisma } from "../config/database";

type RawRequest = Request & { rawBody?: Buffer };

const makeRes = () => {
  const res = { status: jest.fn(), json: jest.fn() } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  (res.json as jest.Mock).mockReturnValue(res);
  return res;
};
const makeNext = () => jest.fn() as jest.MockedFunction<NextFunction>;

describe("webhookController", () => {
  beforeEach(() => jest.clearAllMocks());

  // ── verifyFlutterwaveSignature ─────────────────────────────────────────────

  describe("verifyFlutterwaveSignature", () => {
    it("calls next() with no args on a valid HMAC-SHA256 signature", () => {
      const rawBody = Buffer.from(
        JSON.stringify({ event: "charge.completed" }),
      );
      const sig = crypto
        .createHmac("sha256", FW_SECRET)
        .update(rawBody)
        .digest("hex");
      const req = {
        headers: { "verif-hash": sig },
        rawBody,
      } as unknown as RawRequest;
      const next = makeNext();
      verifyFlutterwaveSignature(req, makeRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it("returns 401 on mismatched signature", () => {
      const rawBody = Buffer.from(
        JSON.stringify({ event: "charge.completed" }),
      );
      const req = {
        headers: { "verif-hash": "a".repeat(64) },
        rawBody,
      } as unknown as RawRequest;
      const res = makeRes();
      verifyFlutterwaveSignature(req, res, makeNext());
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Invalid signature" }),
      );
    });

    it("returns 401 when verif-hash header is absent", () => {
      const rawBody = Buffer.from("{}");
      const req = { headers: {}, rawBody } as unknown as RawRequest;
      const res = makeRes();
      verifyFlutterwaveSignature(req, res, makeNext());
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Missing verif-hash header" }),
      );
    });

    it("returns 400 when rawBody is missing", () => {
      const req = { headers: { "verif-hash": "abc" } } as unknown as RawRequest;
      const res = makeRes();
      verifyFlutterwaveSignature(req, res, makeNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("returns 401 when signature length causes timingSafeEqual to throw (caught internally)", () => {
      const rawBody = Buffer.from("{}");
      const req = {
        headers: { "verif-hash": "tooshort" },
        rawBody,
      } as unknown as RawRequest;
      const res = makeRes();
      verifyFlutterwaveSignature(req, res, makeNext());
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  // ── verifyPaystackSignature ────────────────────────────────────────────────

  describe("verifyPaystackSignature", () => {
    it("calls next() with no args on a valid HMAC-SHA512 signature", () => {
      const rawBody = Buffer.from(JSON.stringify({ event: "charge.success" }));
      const sig = crypto
        .createHmac("sha512", PS_SECRET)
        .update(rawBody)
        .digest("hex");
      const req = {
        headers: { "x-paystack-signature": sig },
        rawBody,
      } as unknown as RawRequest;
      const next = makeNext();
      verifyPaystackSignature(req, makeRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it("returns 401 on mismatched signature", () => {
      const rawBody = Buffer.from("{}");
      const req = {
        headers: { "x-paystack-signature": "deadbeef" },
        rawBody,
      } as unknown as RawRequest;
      const res = makeRes();
      verifyPaystackSignature(req, res, makeNext());
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Invalid signature" }),
      );
    });

    it("returns 401 when x-paystack-signature header is absent", () => {
      const rawBody = Buffer.from("{}");
      const req = { headers: {}, rawBody } as unknown as RawRequest;
      const res = makeRes();
      verifyPaystackSignature(req, res, makeNext());
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Missing x-paystack-signature header",
        }),
      );
    });

    it("returns 400 when rawBody is missing", () => {
      const req = {
        headers: { "x-paystack-signature": "abc" },
      } as unknown as RawRequest;
      const res = makeRes();
      verifyPaystackSignature(req, res, makeNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── handlePaystackWebhook ──────────────────────────────────────────────────

  describe("handlePaystackWebhook", () => {
    it("persists webhook record with paystack: prefix and returns 200", async () => {
      (prisma.webhook.create as jest.Mock).mockResolvedValue({ id: "wh-1" });
      const req = {
        body: {
          event: "charge.success",
          data: { reference: "ref-1", status: "success" },
        },
      } as Request;
      const res = makeRes();
      await handlePaystackWebhook(req, res, makeNext());
      expect(prisma.webhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "paystack:charge.success",
            status: "processed",
          }),
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ status: "ok" });
    });

    it("uses 'unknown' eventType when event field is absent", async () => {
      (prisma.webhook.create as jest.Mock).mockResolvedValue({});
      await handlePaystackWebhook(
        { body: {} } as Request,
        makeRes(),
        makeNext(),
      );
      expect(prisma.webhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: "paystack:unknown" }),
        }),
      );
    });

    it("calls next(error) when DB write fails", async () => {
      (prisma.webhook.create as jest.Mock).mockRejectedValue(
        new Error("DB error"),
      );
      const next = makeNext();
      await handlePaystackWebhook(
        { body: { event: "charge.success" } } as Request,
        makeRes(),
        next,
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── handleFlutterwaveWebhook ───────────────────────────────────────────────

  describe("handleFlutterwaveWebhook", () => {
    it("persists webhook record and returns 200", async () => {
      (prisma.webhook.create as jest.Mock).mockResolvedValue({ id: "wh-2" });
      const req = {
        body: {
          event: "charge.completed",
          data: { tx_ref: "ref-2", status: "successful" },
        },
      } as Request;
      const res = makeRes();
      await handleFlutterwaveWebhook(req, res, makeNext());
      expect(prisma.webhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "charge.completed",
            status: "processed",
          }),
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ status: "ok" });
    });

    it("falls back to payload.type when event field is absent", async () => {
      (prisma.webhook.create as jest.Mock).mockResolvedValue({});
      await handleFlutterwaveWebhook(
        { body: { type: "CARD_TRANSACTION", data: {} } } as Request,
        makeRes(),
        makeNext(),
      );
      expect(prisma.webhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: "CARD_TRANSACTION" }),
        }),
      );
    });

    it("calls next(error) when DB write fails", async () => {
      (prisma.webhook.create as jest.Mock).mockRejectedValue(
        new Error("DB error"),
      );
      const next = makeNext();
      await handleFlutterwaveWebhook({ body: {} } as Request, makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
