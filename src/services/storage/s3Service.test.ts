/**
 * Unit tests for S3 presigned URL security controls — B-062
 *
 * Tests cover:
 *  - buildObjectKey: user-scoped key construction and input sanitisation
 *  - assertKeyOwnership: IDOR prevention
 *  - MIME type validation per document kind
 */

import { config } from "../../config/env";
import * as s3Service from "./s3Service";
import {
  buildObjectKey,
  assertKeyOwnership,
  assertScanAllowsDownload,
  ALLOWED_MIME_TYPES,
  ALL_ALLOWED_MIME_TYPES,
  requireConfiguredS3Bucket,
  generateDownloadUrl,
  getObjectScanStatus,
} from "./s3Service";

const mockS3Send = jest.fn();

jest.mock("@aws-sdk/client-s3", () => {
  class MockHeadObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class MockGetObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class MockGetObjectTaggingCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class MockPutObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class MockPutObjectTaggingCommand {
    constructor(public input: Record<string, unknown>) {}
  }

  return {
    S3Client: jest.fn(() => ({ send: mockS3Send })),
    HeadObjectCommand: MockHeadObjectCommand,
    GetObjectCommand: MockGetObjectCommand,
    GetObjectTaggingCommand: MockGetObjectTaggingCommand,
    PutObjectCommand: MockPutObjectCommand,
    PutObjectTaggingCommand: MockPutObjectTaggingCommand,
  };
});

jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: jest.fn().mockResolvedValue("https://example.com/download"),
}));

// ── buildObjectKey ────────────────────────────────────────────────────────────

describe("buildObjectKey", () => {
  it("produces the expected kyc/{userId}/{kind}/{docId} pattern", () => {
    const key = buildObjectKey("abc123", "passport", "doc-456");
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
    expect(() => assertKeyOwnership("kyc/user-abc/passport/doc-1", "user-abc")).not.toThrow();
  });

  it("throws when the key belongs to a different user (IDOR)", () => {
    expect(() => assertKeyOwnership("kyc/user-abc/passport/doc-1", "user-xyz")).toThrow(
      "Access denied",
    );
  });

  it("throws for a key that does not start with kyc/", () => {
    expect(() => assertKeyOwnership("other/user-abc/passport/doc-1", "user-abc")).toThrow(
      "Access denied",
    );
  });

  it("throws for a key with too few segments", () => {
    expect(() => assertKeyOwnership("kyc/user-abc", "user-abc")).toThrow("Access denied");
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

// ── assertScanAllowsDownload ─────────────────────────────────────────────────

describe("assertScanAllowsDownload", () => {
  it("allows a document the scanner marked clean", () => {
    expect(() => assertScanAllowsDownload("clean")).not.toThrow();
  });

  it("blocks a document the scanner marked infected", () => {
    expect(() => assertScanAllowsDownload("infected")).toThrow(/failed virus scan/);
  });

  it("blocks a document whose scan has not finished", () => {
    expect(() => assertScanAllowsDownload("pending")).toThrow(/pending virus scan/);
  });

  it("blocks an unrecognised status rather than serving the object", () => {
    for (const status of ["unknown", "", "CLEAN", "quarantined"]) {
      expect(() => assertScanAllowsDownload(status)).toThrow();
    }
  });
});

// ── requireConfiguredS3Bucket ────────────────────────────────────────────────

describe("requireConfiguredS3Bucket", () => {
  it("returns a trimmed bucket name", () => {
    expect(requireConfiguredS3Bucket("  example-bucket  ")).toBe("example-bucket");
  });

  it.each([undefined, "", "   "])("throws when bucket is missing: %s", (bucket) => {
    expect(() => requireConfiguredS3Bucket(bucket as string | undefined)).toThrow(
      "S3 bucket is not configured",
    );
  });
});

describe("download access control", () => {
  beforeEach(() => {
    mockS3Send.mockReset();
    config.nodeEnv = "production";
    config.s3 = {
      ...config.s3,
      bucket: "test-bucket",
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    config.nodeEnv = "test";
    config.s3 = {
      ...config.s3,
      bucket: undefined,
    };
  });

  it("rejects download URLs when scan status is unknown", async () => {
    jest.spyOn(s3Service, "getObjectScanStatus").mockResolvedValue("unknown");

    await expect(
      generateDownloadUrl("user-abc", "kyc/user-abc/passport/doc-123"),
    ).rejects.toThrow(/virus scan|unavailable|blocked/i);
  });

  it("treats scan lookup failures as pending/blocked instead of safe", async () => {
    mockS3Send.mockRejectedValueOnce(new Error("scan service unavailable"));

    await expect(getObjectScanStatus("kyc/user-abc/passport/doc-123")).resolves.toBe("pending");
  });
});
