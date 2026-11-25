import express from "express";
import request from "supertest";
import {
  parseCorsOrigins,
  DEFAULT_DEV_CORS_ORIGIN,
  DEFAULT_STAGING_CORS_ORIGIN,
} from "../src/config/corsOrigins";
import { createCorsMiddleware, resolveCorsOrigin } from "../src/middleware/cors";

describe("parseCorsOrigins", () => {
  it("defaults to localhost in non-production when unset", () => {
    expect(parseCorsOrigins(undefined, "development")).toEqual([DEFAULT_DEV_CORS_ORIGIN]);
    expect(parseCorsOrigins(undefined, "test")).toEqual([DEFAULT_DEV_CORS_ORIGIN]);
  });

  it("requires explicit origins in production when unset", () => {
    expect(() => parseCorsOrigins(undefined, "production")).toThrow(
      /CORS_ORIGIN is required in production/,
    );
    expect(() => parseCorsOrigins(undefined, "Production")).toThrow(
      /CORS_ORIGIN is required in production/,
    );
  });

  it("rejects wildcard *", () => {
    expect(() => parseCorsOrigins("*", "development")).toThrow(/wildcard/i);
    expect(() => parseCorsOrigins("https://a.com,*", "development")).toThrow(/wildcard/i);
  });

  it("parses, trims, and deduplicates comma-separated origins", () => {
    expect(
      parseCorsOrigins(
        " https://app.example.com ,https://admin.example.com,https://app.example.com ",
        "development",
      ),
    ).toEqual(["https://app.example.com", "https://admin.example.com"]);
  });

  it("normalizes valid origins to URL.origin form", () => {
    expect(parseCorsOrigins("https://app.example.com:443", "development")).toEqual([
      "https://app.example.com",
    ]);
  });

  it("rejects origins with paths or trailing slashes", () => {
    expect(() => parseCorsOrigins("https://app.example.com/dashboard", "development")).toThrow(
      /scheme, host, and port only/i,
    );
    expect(() => parseCorsOrigins("https://app.example.com/", "development")).toThrow(
      /scheme, host, and port only/i,
    );
  });

  // W11-AUD-011: staging and test environments must use an explicit allowlist,
  // not a catch-all, to prevent credential leakage from malicious pages.
  it("includes localhost and staging origin in default list for staging environment", () => {
    const origins = parseCorsOrigins(undefined, "staging");
    expect(origins).toContain(DEFAULT_DEV_CORS_ORIGIN);
    expect(origins).toContain(DEFAULT_STAGING_CORS_ORIGIN);
    expect(origins).not.toContain("*");
  });

  it("includes localhost and staging origin in default list for test environment", () => {
    const origins = parseCorsOrigins(undefined, "test");
    expect(origins).toContain(DEFAULT_DEV_CORS_ORIGIN);
    expect(origins).toContain(DEFAULT_STAGING_CORS_ORIGIN);
    expect(origins).not.toContain("*");
  });

  it("still rejects wildcard in staging environment", () => {
    expect(() => parseCorsOrigins("*", "staging")).toThrow(/wildcard/i);
  });

  it("still rejects wildcard in test environment", () => {
    expect(() => parseCorsOrigins("*", "test")).toThrow(/wildcard/i);
  });

  it("honours an explicit CORS_ORIGIN list in staging (overrides defaults)", () => {
    const custom = "https://custom-staging.acbu.io";
    const origins = parseCorsOrigins(custom, "staging");
    expect(origins).toEqual([custom]);
  });
});

describe("resolveCorsOrigin", () => {
  const allowed = ["http://localhost:3000", "https://app.example.com"];

  it("returns null when Origin header is absent", () => {
    expect(resolveCorsOrigin(undefined, allowed)).toBeNull();
  });

  it("returns the request origin when it is on the allowlist", () => {
    expect(resolveCorsOrigin("https://app.example.com", allowed)).toBe("https://app.example.com");
  });

  it("returns false for origins not on the allowlist", () => {
    expect(resolveCorsOrigin("https://evil.example.com", allowed)).toBe(false);
  });
});

describe("createCorsMiddleware", () => {
  const allowedOrigin = "http://localhost:3000";

  function buildApp(allowedOrigins: string[]) {
    const app = express();
    app.use(createCorsMiddleware(allowedOrigins));
    app.get("/ping", (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  it("reflects an allowed Origin (never *) with credentials", async () => {
    const res = await request(buildApp([allowedOrigin]))
      .get("/ping")
      .set("Origin", allowedOrigin)
      .expect(200);

    expect(res.headers["access-control-allow-origin"]).toBe(allowedOrigin);
    expect(res.headers["access-control-allow-origin"]).not.toBe("*");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("rejects disallowed cross-origin requests", async () => {
    const res = await request(buildApp([allowedOrigin]))
      .get("/ping")
      .set("Origin", "https://evil.example.com");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("handles preflight OPTIONS with reflected origin", async () => {
    const res = await request(buildApp([allowedOrigin]))
      .options("/ping")
      .set("Origin", allowedOrigin)
      .set("Access-Control-Request-Method", "GET")
      .expect(204);

    expect(res.headers["access-control-allow-origin"]).toBe(allowedOrigin);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });
});
