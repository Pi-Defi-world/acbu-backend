import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { middleware } from "../../middleware";

describe("middleware CSP reporting", () => {
  it("points CSP violations at the report endpoint", () => {
    // A request that already has a locale prefix avoids the redirect path
    // and proceeds straight to the CSP/security-header logic.
    const request = new NextRequest("https://example.com/en/dashboard");

    const response = middleware(request);
    const policy = response.headers.get("Content-Security-Policy");

    expect(policy).toContain("report-uri /api/csp-report");
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(response.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(response.headers.get("Strict-Transport-Security")).toContain(
      "max-age=",
    );
  });
});

describe("middleware locale redirect", () => {
  it("redirects bare route to default locale prefix when no cookie set", () => {
    const request = new NextRequest("https://example.com/mint");
    const response = middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/en/mint");
  });

  it("redirects using locale from NEXT_LOCALE cookie", () => {
    const request = new NextRequest("https://example.com/send", {
      headers: { cookie: "NEXT_LOCALE=en-NG" },
    });
    const response = middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/en-NG/send");
  });

  it("redirects / to /{locale}", () => {
    const request = new NextRequest("https://example.com/", {
      headers: { cookie: "NEXT_LOCALE=ar" },
    });
    const response = middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toMatch(/\/ar$/);
  });

  it("does NOT redirect a path already prefixed with a valid locale", () => {
    const request = new NextRequest("https://example.com/en-KE/wallet");
    const response = middleware(request);

    // Should pass through to CSP logic, not a redirect
    expect(response.status).not.toBe(307);
    expect(response.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("does NOT redirect API routes", () => {
    const request = new NextRequest("https://example.com/api/csp-report");
    const response = middleware(request);

    expect(response.status).not.toBe(307);
    expect(response.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("negotiates locale from Accept-Language header when no cookie", () => {
    const request = new NextRequest("https://example.com/burn", {
      headers: { "accept-language": "ar,en;q=0.9" },
    });
    const response = middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/ar/burn");
    expect(response.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("falls back to 'en' when Accept-Language lists no supported locale", () => {
    const request = new NextRequest("https://example.com/wallet", {
      headers: { "accept-language": "fr-FR,fr;q=0.9" },
    });
    const response = middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/en/wallet");
  });

  it("sets NEXT_LOCALE cookie on redirect response", () => {
    const request = new NextRequest("https://example.com/transactions");
    const response = middleware(request);

    expect(response.status).toBe(307);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("NEXT_LOCALE=en");
    expect(response.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("returns 404 for .md paths regardless of locale prefix", () => {
    const request = new NextRequest("https://example.com/README.md");
    const response = middleware(request);

    expect(response.status).toBe(404);
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });
});
