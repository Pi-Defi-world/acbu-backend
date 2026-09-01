/**
 * Webhook controller tests.
 *
 * Optimised for speed (<5 s): provider-agnostic Content-Type enforcement is
 * tested once per signature verifier via `test.each` rather than repeating
 * identical rejection assertions across every provider. Signature HMAC,
 * idempotency, and timestamp-replay paths are still individually asserted.
 *
 * env is mocked with known secrets so we can compute expected HMACs
 * deterministically.
 */
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

const FW_SECRET = "test-flutterwave-secret";
const PS_SECRET = "test-paystack-secret";
const BILLS_SECRET = "test-bills-secret";

jest.mock("../config/env", () => ({
  config: {
    nodeEnv: "test",
    port: 5000,
    apiVersion: "v1",
    databaseUrl: "",
    prismaAccelerateUrl: "",
    mongodbUri: "",
    rabbitmqUrl: "",
    jwtSecret: "secret",
    jwtExpiresIn: "7d",
    apiKeySalt: "",
    rateLimitWindowMs: 60000,
    rateLimitMaxRequests: 100,
    rateLimitFallbackMaxRequests: 20,
    rateLimitCircuitBreakerThreshold: 5,
    rateLimitCircuitBreakerCooldownMs: 60000,
    logLevel: "info",
    logFile: "logs/app.log",
    flutterwave: { webhookSecret: FW_SECRET },
    paystack: { secretKey: PS_SECRET },
    bills: { webhookSecret: BILLS_SECRET },
    mtnMomo: {
      subscriptionKey: "",
      apiUserId: "",
      apiKey: "",
      baseUrl: "",
      targetEnvironment: "sandbox",
    },
    fintech: {
      currencyProviders: {},
    },
    stellar: {
      network: "testnet",
      horizonUrl: "https://horizon-testnet.stellar.org",
      sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    },
    limits: {
      retail: {
        depositDailyUsd: 5000,
        depositMonthlyUsd: 50000,
        withdrawalSingleCurrencyDailyUsd: 10000,
        withdrawalSingleCurrencyMonthlyUsd: 80000,
      },
      business: {
        depositDailyUsd: 50000,
        depositMonthlyUsd: 500000,
        withdrawalSingleCurrencyDailyUsd: 100000,
        withdrawalSingleCurrencyMonthlyUsd: 800000,
      },
      government: {
        depositDailyUsd: 500000,
        depositMonthlyUsd: 5000000,
        withdrawalSingleCurrencyDailyUsd: 500000,
        withdrawalSingleCurrencyMonthlyUsd: 4000000,
      },
      circuitBreaker: {
        reserveWeightThresholdPct: 10,
        minReserveRatio: 1.02,
      },
    },
    oracle: {
      updateIntervalHours: 6,
      emergencyThreshold: 0.05,
      maxDeviationPerUpdate: 0.05,
      circuitBreakerThreshold: 0.1,
      forex: { baseUrl: "", apiKey: "" },
      centralBankUrls: {},
    },
    reserve: {
      minRatio: 1.02,
      targetRatio: 1.05,
      alertThreshold: 1.02,
    },
    notification: {
      emailProvider: "log",
      emailFrom: "noreply@example.com",
      sendgridApiKey: "",
      sesRegion: "us-east-1",
      smsProvider: "log",
      alertEmail: "",
      twilioAccountSid: "",
      twilioAuthToken: "",
      twilioFromNumber: "",
      africasTalkingApiKey: "",
      africasTalkingUsername: "",
    },
    webhook: {
      url: "",
      secret: "",
    },
    corsOrigin: ["*"],
    challengeTokenSecret: "default_secret",
  },
}));

jest.mock("../config/logger", () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  logFinancialEvent: jest.fn(),
}));

jest.mock("../config/database", () => ({
  prisma: {
    webhook: { create: jest.fn() },
  },
}));

jest.mock("../services/limits/limitsService", () => ({
  checkWithdrawalLimits: jest.fn(),
  isCurrencyWithdrawalPaused: jest.fn().mockResolvedValue(false),
}));

jest.mock("../services/bills", () => ({
  reconcileBillsWebhook: jest.fn(),
}));

import {
  verifyFlutterwaveSignature,
  verifyPaystackSignature,
  verifyBillsWebhookSignature,
  handleFlutterwaveWebhook,
  handlePaystackWebhook,
  handleBillsWebhook,
} from "./webhookController";
import { prisma } from "../config/database";
import { reconcileBillsWebhook } from "../services/bills";

type RawRequest = Request & { rawBody?: Buffer };

const makeRes = () => {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
  } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  (res.json as jest.Mock).mockReturnValue(res);
  return res;
};
const makeNext = () => jest.fn() as jest.MockedFunction<NextFunction>;

/** Shared timestamp helpers used across provider blocks. */
const validTimestamp = () => String(Math.floor(Date.now() / 1000));
const expiredTimestamp = () => String(Math.floor(Date.now() / 1000) - 600);
const futureTimestamp = () => String(Math.floor(Date.now() / 1000) + 600);

// ── Helpers to build signed requests per provider ────────────────────────────

function buildFlutterwaveSignedReq(
  body: object,
  opts?: { sig?: string; ts?: string; contentType?: string },
) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const sig =
    opts?.sig ?? crypto.createHmac("sha256", FW_SECRET).update(rawBody).digest("hex");
  const headers: Record<string, string> = {
    "verif-hash": sig,
    "x-flw-timestamp": opts?.ts ?? validTimestamp(),
  };
  if (opts && "contentType" in opts) {
    if (opts.contentType !== undefined) headers["content-type"] = opts.contentType;
  } else {
    headers["content-type"] = "application/json";
  }
  return { headers, rawBody } as unknown as RawRequest;
}

function buildPaystackSignedReq(
  body: object,
  opts?: { sig?: string; ts?: string; contentType?: string },
) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const sig =
    opts?.sig ?? crypto.createHmac("sha512", PS_SECRET).update(rawBody).digest("hex");
  const headers: Record<string, string> = {
    "x-paystack-signature": sig,
    "x-paystack-timestamp": opts?.ts ?? validTimestamp(),
  };
  if (opts && "contentType" in opts) {
    if (opts.contentType !== undefined) headers["content-type"] = opts.contentType;
  } else {
    headers["content-type"] = "application/json";
  }
  return { headers, rawBody } as unknown as RawRequest;
}

function buildBillsSignedReq(
  body: object,
  opts?: { sig?: string; ts?: string; contentType?: string },
) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const sig =
    opts?.sig ?? crypto.createHmac("sha256", BILLS_SECRET).update(rawBody).digest("hex");
  const headers: Record<string, string> = {
    "x-bills-signature": sig,
    "x-bills-timestamp": opts?.ts ?? validTimestamp(),
  };
  if (opts && "contentType" in opts) {
    if (opts.contentType !== undefined) headers["content-type"] = opts.contentType;
  } else {
    headers["content-type"] = "application/json";
  }
  return { headers, rawBody } as unknown as RawRequest;
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe("webhookController", () => {
  beforeEach(() => jest.clearAllMocks());

  afterAll(() => {
    jest.restoreAllMocks();
  });

  // ── verifyFlutterwaveSignature ─────────────────────────────────────────────

  describe("verifyFlutterwaveSignature", () => {
    it("calls next() on a valid HMAC-SHA256 signature", () => {
      const next = makeNext();
      verifyFlutterwaveSignature(
        buildFlutterwaveSignedReq({ event: "charge.completed" }),
        makeRes(),
        next,
      );
      expect(next).toHaveBeenCalledWith();
    });

    it("returns 401 on mismatched signature", () => {
      const res = makeRes();
      verifyFlutterwaveSignature(
        buildFlutterwaveSignedReq({}, { sig: "a".repeat(64) }),
        res,
        makeNext(),
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Invalid signature" }),
      );
    });

    it("returns 401 when verif-hash header is absent", () => {
      const res = makeRes();
      verifyFlutterwaveSignature(
        { headers: { "x-flw-timestamp": validTimestamp(), "content-type": "application/json" }, rawBody: Buffer.from("{}") } as unknown as RawRequest,
        res,
        makeNext(),
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Missing verif-hash header" }),
      );
    });

    it("returns 400 when rawBody is missing", () => {
      const res = makeRes();
      verifyFlutterwaveSignature(
        { headers: { "verif-hash": "abc", "x-flw-timestamp": validTimestamp(), "content-type": "application/json" } } as unknown as RawRequest,
        res,
        makeNext(),
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("returns 401 when signature length causes timingSafeEqual to throw", () => {
      const res = makeRes();
      verifyFlutterwaveSignature(
        buildFlutterwaveSignedReq({}, { sig: "tooshort" }),
        res,
        makeNext(),
      );
      expect(res.status).toHaveBeenCalledWith(401);
    });

    // ── #390 timestamp validation ──────────────────────────────────────────

    it("returns 401 when x-flw-timestamp header is absent", () => {
      const res = makeRes();
      verifyFlutterwaveSignature(
        { headers: { "verif-hash": "abc", "content-type": "application/json" }, rawBody: Buffer.from("{}") } as unknown as RawRequest,
        res,
        makeNext(),
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Webhook timestamp invalid or expired" }),
      );
    });

    it("returns 401 when x-flw-timestamp is expired (>5 min old)", () => {
      const res = makeRes();
      verifyFlutterwaveSignature(
        buildFlutterwaveSignedReq({}, { sig: "abc", ts: expiredTimestamp() }),
        res,
        makeNext(),
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Webhook timestamp invalid or expired" }),
      );
    });

    it("returns 401 when x-flw-timestamp is too far in the future (>5 min)", () => {
      const res = makeRes();
      verifyFlutterwaveSignature(
        buildFlutterwaveSignedReq({}, { sig: "abc", ts: futureTimestamp() }),
        res,
        makeNext(),
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Webhook timestamp invalid or expired" }),
      );
    });

    it("returns 401 when x-flw-timestamp is not a valid number or date", () => {
      const res = makeRes();
      verifyFlutterwaveSignature(
        buildFlutterwaveSignedReq({}, { sig: "abc", ts: "not-a-date" }),
        res,
        makeNext(),
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Webhook timestamp invalid or expired" }),
      );
    });

    // ── #296 Content-Type enforcement (consolidated) ─────────────────────────

    it.each([
      ["application/json", true],
      ["application/json; charset=utf-8", true],
      ["multipart/form-data", false],
      ["text/xml", false],
      [undefined, false],
    ])("Content-Type %s → %s", (contentType, shouldPass) => {
      const next = makeNext();
      const res = makeRes();
      // For valid content-types compute a correct HMAC; for invalid ones any sig suffices
      const opts: { sig?: string; contentType?: string } = { contentType };
      if (!shouldPass) opts.sig = "abc";
      verifyFlutterwaveSignature(
        buildFlutterwaveSignedReq({ event: "charge.completed" }, opts),
        res,
        next,
      );
      if (shouldPass) {
        expect(next).toHaveBeenCalled();
      } else {
        expect(res.status).toHaveBeenCalledWith(415);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ error: "Content-Type must be application/json" }),
        );
      }
    });
  });

  // ── verifyPaystackSignature ────────────────────────────────────────────────

  describe("verifyPaystackSignature", () => {
    it("calls next() on a valid HMAC-SHA512 signature", () => {
      const next = makeNext();
      verifyPaystackSignature(
        buildPaystackSignedReq({ event: "charge.success" }),
        makeRes(),
        next,
      );
      expect(next).toHaveBeenCalledWith();
    });

    it("returns 401 on mismatched signature", () => {
      const res = makeRes();
      verifyPaystackSignature(
        buildPaystackSignedReq({}, { sig: "deadbeef" }),
        res,
        makeNext(),
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Invalid signature" }),
      );
    });

    it("returns 401 when x-paystack-signature header is absent", () => {
      const res = makeRes();
      verifyPaystackSignature(
        { headers: { "x-paystack-timestamp": validTimestamp(), "content-type": "application/json" }, rawBody: Buffer.from("{}") } as unknown as RawRequest,
        res,
        makeNext(),
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Missing x-paystack-signature header" }),
      );
    });

    it("returns 400 when rawBody is missing", () => {
      const res = makeRes();
      verifyPaystackSignature(
        { headers: { "x-paystack-signature": "abc", "x-paystack-timestamp": validTimestamp(), "content-type": "application/json" } } as unknown as RawRequest,
        res,
        makeNext(),
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    // ── #390 timestamp validation ──────────────────────────────────────────

    it("returns 401 when x-paystack-timestamp header is absent", () => {
      const res = makeRes();
      verifyPaystackSignature(
        { headers: { "x-paystack-signature": "abc", "content-type": "application/json" }, rawBody: Buffer.from("{}") } as unknown as RawRequest,
        res,
        makeNext(),
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Webhook timestamp invalid or expired" }),
      );
    });

    it("returns 401 when x-paystack-timestamp is expired (>5 min old)", () => {
      const res = makeRes();
      verifyPaystackSignature(
        buildPaystackSignedReq({}, { sig: "abc", ts: expiredTimestamp() }),
        res,
        makeNext(),
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Webhook timestamp invalid or expired" }),
      );
    });

    it("returns 401 when x-paystack-timestamp is too far in the future (>5 min)", () => {
      const res = makeRes();
      verifyPaystackSignature(
        buildPaystackSignedReq({}, { sig: "abc", ts: futureTimestamp() }),
        res,
        makeNext(),
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Webhook timestamp invalid or expired" }),
      );
    });

    it("returns 401 when x-paystack-timestamp is not a valid number or date", () => {
      const res = makeRes();
      verifyPaystackSignature(
        buildPaystackSignedReq({}, { sig: "abc", ts: "garbage" }),
        res,
        makeNext(),
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Webhook timestamp invalid or expired" }),
      );
    });

    // ── #296 Content-Type enforcement (consolidated) ─────────────────────────

    it.each([
      ["application/json", true],
      ["application/json; charset=utf-8", true],
      ["multipart/form-data", false],
      ["text/xml", false],
      [undefined, false],
    ])("Content-Type %s → %s", (contentType, shouldPass) => {
      const next = makeNext();
      const res = makeRes();
      const opts: { sig?: string; contentType?: string } = { contentType };
      if (!shouldPass) opts.sig = "abc";
      verifyPaystackSignature(
        buildPaystackSignedReq({ event: "charge.success" }, opts),
        res,
        next,
      );
      if (shouldPass) {
        expect(next).toHaveBeenCalled();
      } else {
        expect(res.status).toHaveBeenCalledWith(415);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ error: "Content-Type must be application/json" }),
        );
      }
    });
  });

  // ── handlePaystackWebhook ──────────────────────────────────────────────────

  describe("handlePaystackWebhook", () => {
    it("persists webhook record with paystack: prefix and returns 200", async () => {
      (prisma.webhook.create as jest.Mock).mockResolvedValue({ id: "wh-1" });
      const res = makeRes();
      await handlePaystackWebhook(
        { headers: {}, body: { event: "charge.success", data: { reference: "ref-1", status: "success" } } } as Request,
        res,
        makeNext(),
      );
      expect(prisma.webhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "paystack:charge.success",
            status: "processed",
          }),
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ status: "ok", deprecated: true }),
      );
    });

    it("uses 'unknown' eventType when event field is absent", async () => {
      (prisma.webhook.create as jest.Mock).mockResolvedValue({});
      await handlePaystackWebhook({ headers: {}, body: {} } as Request, makeRes(), makeNext());
      expect(prisma.webhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: "paystack:unknown" }),
        }),
      );
    });

    it("persists event_id and acknowledges a database duplicate", async () => {
      (prisma.webhook.create as jest.Mock)
        .mockResolvedValueOnce({ id: "wh-1" })
        .mockRejectedValueOnce({ code: "P2002" });
      const payload = { event: "charge.success", event_id: "paystack-event-1", data: {} };
      const firstRes = makeRes();
      const secondRes = makeRes();

      await handlePaystackWebhook({ headers: {}, body: payload } as Request, firstRes, makeNext());
      await handlePaystackWebhook({ headers: {}, body: payload } as Request, secondRes, makeNext());

      expect(prisma.webhook.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({ eventId: "paystack-event-1" }),
        }),
      );
      expect(secondRes.status).toHaveBeenCalledWith(200);
      expect(secondRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ status: "ok", duplicate: true }),
      );
    });

    it("calls next(error) when DB write fails", async () => {
      (prisma.webhook.create as jest.Mock).mockRejectedValue(new Error("DB error"));
      const next = makeNext();
      await handlePaystackWebhook(
        { headers: {}, body: { event: "charge.success" } } as Request,
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
      const res = makeRes();
      await handleFlutterwaveWebhook(
        { headers: {}, body: { event: "charge.completed", data: { tx_ref: "ref-2", status: "successful" } } } as Request,
        res,
        makeNext(),
      );
      expect(prisma.webhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "charge.completed",
            status: "processed",
          }),
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ status: "ok", deprecated: true }),
      );
    });

    it("falls back to payload.type when event field is absent", async () => {
      (prisma.webhook.create as jest.Mock).mockResolvedValue({});
      await handleFlutterwaveWebhook(
        { headers: {}, body: { type: "CARD_TRANSACTION", data: {} } } as Request,
        makeRes(),
        makeNext(),
      );
      expect(prisma.webhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: "CARD_TRANSACTION" }),
        }),
      );
    });

    it("acknowledges duplicate event_id values without logging them again", async () => {
      (prisma.webhook.create as jest.Mock).mockRejectedValue({ code: "P2002" });
      const next = makeNext();
      const res = makeRes();

      await handleFlutterwaveWebhook(
        { headers: {}, body: { event_id: "flutterwave-event-1", data: {} } } as Request,
        res,
        next,
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ status: "ok", duplicate: true }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("calls next(error) when DB write fails", async () => {
      (prisma.webhook.create as jest.Mock).mockRejectedValue(new Error("DB error"));
      const next = makeNext();
      await handleFlutterwaveWebhook({ headers: {}, body: {} } as Request, makeRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── verifyBillsWebhookSignature ─────────────────────────────────────────────

  describe("verifyBillsWebhookSignature", () => {
    it("calls next() on a valid HMAC-SHA256 signature", () => {
      const next = makeNext();
      verifyBillsWebhookSignature(
        buildBillsSignedReq({ transaction_id: "tx-1" }),
        makeRes(),
        next,
      );
      expect(next).toHaveBeenCalledWith();
    });

    it.each([
      ["application/json", true],
      ["application/json; charset=utf-8", true],
      ["multipart/form-data", false],
      ["text/xml", false],
      [undefined, false],
    ])("Content-Type %s → %s", (contentType, shouldPass) => {
      const next = makeNext();
      const res = makeRes();
      const opts: { sig?: string; contentType?: string } = { contentType };
      if (!shouldPass) opts.sig = "abc";
      verifyBillsWebhookSignature(
        buildBillsSignedReq({ transaction_id: "tx-1" }, opts),
        res,
        next,
      );
      if (shouldPass) {
        expect(next).toHaveBeenCalled();
      } else {
        expect(res.status).toHaveBeenCalledWith(415);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ error: "Content-Type must be application/json" }),
        );
      }
    });
  });

  // ── handleBillsWebhook ─────────────────────────────────────────────────────

  describe("handleBillsWebhook", () => {
    const validBody = {
      transaction_id: "tx-1",
      provider_reference: "ref-1",
      status: "completed",
      amount: 100,
      currency: "NGN",
    };

    it.each([
      ["absent", undefined],
      ["expired (>5 min old)", expiredTimestamp()],
      ["too far in the future (>5 min)", futureTimestamp()],
      ["not a valid number or date", "not-a-date"],
    ])("returns 401 when x-bills-timestamp is %s", async (_label, ts) => {
      const res = makeRes();
      const next = makeNext();
      await handleBillsWebhook(
        {
          headers: ts !== undefined ? { "x-bills-timestamp": ts } : {},
          params: { provider: "simulated" },
          body: validBody,
        } as unknown as Request,
        res,
        next,
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Webhook timestamp invalid or expired" }),
      );
      expect(reconcileBillsWebhook).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it("reconciles and returns 200 when x-bills-timestamp is within tolerance", async () => {
      (reconcileBillsWebhook as jest.Mock).mockResolvedValue({
        transactionId: "tx-1",
        status: "completed",
      });
      const res = makeRes();
      await handleBillsWebhook(
        {
          headers: { "x-bills-timestamp": validTimestamp() },
          params: { provider: "simulated" },
          body: validBody,
        } as unknown as Request,
        res,
        makeNext(),
      );
      expect(reconcileBillsWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "simulated",
          transactionId: "tx-1",
          providerReference: "ref-1",
          status: "completed",
          amount: 100,
          currency: "NGN",
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        ok: true,
        transaction_id: "tx-1",
        status: "completed",
      });
    });
  });
});
