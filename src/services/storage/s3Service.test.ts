/**
 * Unit tests for S3 presigned URL security controls — B-062
 *
 * Tests cover:
 *  - buildObjectKey: user-scoped key construction and input sanitisation
 *  - assertKeyOwnership: IDOR prevention
 *  - MIME type validation per document kind
 */

import {
  buildObjectKey,
  assertKeyOwnership,
  ALLOWED_MIME_TYPES,
  ALL_ALLOWED_MIME_TYPES,
} from "./s3Service";

// ── buildObjectKey ────────────────────────────────────────────────────────────

describe("buildObjectKey", () => {
  it("produces the expected kyc/{userId}/{kind}/{docId} pattern", () => {
    const key = buildObjectKey(
      "abc123",
      "passport",
      "doc-456",
    );
    expect(key).toBe("kyc/abc123/passport/doc-456");
  });

  it("strips path-traversal characters from userId", () => {
    const key = buildObjectKey("../evil/../user", "passport", "doc-1");
    // slashes and dots are stripped — cannot escape the user prefix
    expect(key).not.toContain("..");
    expect(key).not.toContain("/evil/");
    expect(key.startsWith("kyc/")).toBe(true);
  });

  it("strips special characters from documentKind", () => {
    const key = buildObjectKey("user1", "pass;port<>", "doc-1");
    expect(key).not.toContain(";");
    expect(key).not.toContain("<");
  });

  it("strips special characters from documentId", () => {
    const key = buildObjectKey("user1", "passport", "doc/../evil");
    expect(key).not.toContain("..");
  });
});

// ── assertKeyOwnership ────────────────────────────────────────────────────────

describe("assertKeyOwnership", () => {
  it("passes when the key belongs to the requesting user", () => {
    expect(() =>
      assertKeyOwnership("kyc/user-abc/passport/doc-1", "user-abc"),
    ).not.toThrow();
  });

  it("throws when the key belongs to a different user (IDOR)", () => {
    expect(() =>
      assertKeyOwnership("kyc/user-abc/passport/doc-1", "user-xyz"),
    ).toThrow("Access denied");
  });

  it("throws for a key that does not start with kyc/", () => {
    expect(() =>
      assertKeyOwnership("other/user-abc/passport/doc-1", "user-abc"),
    ).toThrow("Access denied");
  });

  it("throws for a key with too few segments", () => {
    expect(() =>
      assertKeyOwnership("kyc/user-abc", "user-abc"),
    ).toThrow("Access denied");
  });

  it("throws for an empty key", () => {
    expect(() => assertKeyOwnership("", "user-abc")).toThrow("Access denied");
  });
});

// ── ALLOWED_MIME_TYPES ────────────────────────────────────────────────────────

describe("ALLOWED_MIME_TYPES", () => {
  it("does not allow executable MIME types for any document kind", () => {
    const dangerous = [
      "application/x-msdownload",
      "application/x-executable",
      "application/octet-stream",
      "text/html",
      "application/javascript",
    ];
    for (const kind of Object.keys(ALLOWED_MIME_TYPES)) {
      for (const mime of dangerous) {
        expect(ALLOWED_MIME_TYPES[kind]).not.toContain(mime);
      }
    }
  });

  it("selfie only allows images, not PDFs", () => {
    expect(ALLOWED_MIME_TYPES["selfie"]).not.toContain("application/pdf");
    expect(ALLOWED_MIME_TYPES["selfie"]).toContain("image/jpeg");
    expect(ALLOWED_MIME_TYPES["selfie"]).toContain("image/png");
  });

  it("ALL_ALLOWED_MIME_TYPES contains no duplicates", () => {
    const unique = new Set(ALL_ALLOWED_MIME_TYPES);
    expect(unique.size).toBe(ALL_ALLOWED_MIME_TYPES.length);
  });
});
