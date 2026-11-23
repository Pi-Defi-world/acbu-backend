// src/config/env.ts currently fails at import time on dev, so isolate the
// logger dependency of requestLogger for these unit tests.
jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), debug: jest.fn(), isDebugEnabled: jest.fn(() => true) },
}));

import express from "express";
import request from "supertest";
import { normalizeTimestamps } from "../src/utils/isoTimestamps";
import { isoTimestampSerializer } from "../src/middleware/isoTimestamps";
import { createApiDocsRouter } from "../src/routes/apiDocs";
import { sanitizeRequestBody } from "../src/middleware/requestLogger";
import { redactLogValue } from "../src/config/logRedaction";

describe("W11-AUD-022: ISO 8601 timestamp serialisation", () => {
  const ms = Date.UTC(2026, 10, 20, 12, 0, 0);
  const iso = "2026-11-20T12:00:00.000Z";

  it("converts epoch-ms under timestamp keys and Date instances to ISO strings", () => {
    expect(
      normalizeTimestamps({
        createdAt: ms,
        updated_at: new Date(ms),
        timestamp: ms,
        nested: [{ completedAt: ms, settlementDate: ms }],
      }),
    ).toEqual({
      createdAt: iso,
      updated_at: iso,
      timestamp: iso,
      nested: [{ completedAt: iso, settlementDate: iso }],
    });
  });

  it("leaves ISO strings, non-timestamp numbers and out-of-range values untouched", () => {
    const input = {
      createdAt: iso,
      amount: ms,
      timestamp: 0,
      expiresAt: 1_800_000_000, // epoch seconds: ambiguous, not converted
      count: 3,
    };
    expect(normalizeTimestamps(input)).toEqual(input);
  });

  it("does not mutate the input and maps invalid Dates to null", () => {
    const input = { createdAt: ms, deletedAt: new Date("nope") };
    expect(normalizeTimestamps(input)).toEqual({ createdAt: iso, deletedAt: null });
    expect(input.createdAt).toBe(ms);
  });

  it("is applied to res.json responses by the middleware", async () => {
    const app = express();
    app.use(isoTimestampSerializer);
    app.get("/t", (_req, res) => {
      res.json({ data: [{ id: "1", createdAt: ms, processedAt: new Date(ms) }] });
    });
    const res = await request(app).get("/t").expect(200);
    expect(res.body).toEqual({ data: [{ id: "1", createdAt: iso, processedAt: iso }] });
  });
});

describe("W11-AUD-024: Cache-Control on API documentation", () => {
  const app = express();
  app.use(
    "/api-docs",
    createApiDocsRouter({ openapi: "3.0.0", info: { title: "t", version: "1" }, paths: {} }),
  );

  it("serves the docs page with no-cache and versioned asset URLs", async () => {
    const res = await request(app).get("/api-docs").expect(200);
    expect(res.headers["cache-control"]).toBe("no-cache");
    const match = res.text.match(/href="(\/api-docs\/assets\/[^"]+\/swagger-ui\.css)"/);
    expect(match).not.toBeNull();
    expect(res.text).toContain('src="/api-docs/swagger-ui-init.js"');

    const asset = await request(app).get(match![1]).expect(200);
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(asset.headers["etag"]).toBeDefined();
  });

  it("serves the spec-bearing init script with no-cache", async () => {
    const res = await request(app).get("/api-docs/swagger-ui-init.js").expect(200);
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.text).toContain("swaggerDoc");
  });

  it("serves unversioned legacy asset URLs with no-cache", async () => {
    const res = await request(app).get("/api-docs/swagger-ui.css").expect(200);
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("does not expose package.json", async () => {
    await request(app).get("/api-docs/package.json").expect(404);
  });
});

describe("W11-AUD-025: request body sanitisation before logging", () => {
  it("masks passwords, national IDs, secret keys, tokens and bank details", () => {
    const body = {
      email: "a@b.co",
      password: "hunter2",
      bvn: "22222222222",
      nin: "11111111111",
      secretKey: "SXXXX",
      secret_key: "SXXXX",
      token: "abc",
      profile: { nationalId: "A1", accountNumber: "0123456789", bank_account: "x", iban: "GB00" },
      amount: "100",
    };
    expect(sanitizeRequestBody(body)).toEqual({
      email: "a@b.co",
      password: "[REDACTED]",
      bvn: "[REDACTED]",
      nin: "[REDACTED]",
      secretKey: "[REDACTED]",
      secret_key: "[REDACTED]",
      token: "[REDACTED]",
      profile: {
        nationalId: "[REDACTED]",
        accountNumber: "[REDACTED]",
        bank_account: "[REDACTED]",
        iban: "[REDACTED]",
      },
      amount: "100",
    });
    expect(body.password).toBe("hunter2");
  });

  it("logger redaction also covers NIN / bank account keys without over-matching", () => {
    expect(
      redactLogValue({
        ninNumber: "1",
        national_id: "2",
        account_no: "3",
        mining: "ok",
        accountId: "acc-1",
      }),
    ).toEqual({
      ninNumber: "[REDACTED]",
      national_id: "[REDACTED]",
      account_no: "[REDACTED]",
      mining: "ok",
      accountId: "acc-1",
    });
  });
});

describe("W11-AUD-025: requestLogger never emits raw bodies", () => {
  it("logs only a sanitised body at debug level", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { logger } = require("../src/config/logger");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requestLogger } = require("../src/middleware/requestLogger");
    const app = express();
    app.use(express.json());
    app.use(requestLogger);
    app.post("/v1/auth/signup", (_req, res) => {
      res.status(201).json({ ok: true });
    });

    await request(app)
      .post("/v1/auth/signup")
      .send({ username: "ada", password: "hunter2", nin: "11111111111" })
      .expect(201);

    const auditCall = (logger.info as jest.Mock).mock.calls.find((c) => c[0] === "audit_request");
    expect(JSON.stringify(auditCall)).not.toContain("hunter2");

    const debugCall = (logger.debug as jest.Mock).mock.calls.find((c) => c[0] === "request_body");
    expect(debugCall[1].body).toEqual({
      username: "ada",
      password: "[REDACTED]",
      nin: "[REDACTED]",
    });
  });
});
