/**
 * KYC Controller Tests — W10-TEST-001
 *
 * Covers:
 *  - requestUploadUrl  (submission path)
 *  - confirmUpload     (confirmation / checksum recording)
 *  - requestDownloadUrl (download-gate / scan-status)
 *  - scanWebhook       (virus-scanner callback — approval / rejection flags)
 *
 * Compliance-relevant assertions:
 *  - Unauthenticated requests are rejected (401)
 *  - Documents belonging to another user are access-denied (403)
 *  - Infected documents are quarantined and block download (422)
 *  - HMAC signature verification rejects tampered payloads (401)
 *  - Invalid MIME types / schema violations surface as 400
 */

import {
  requestUploadUrl,
  confirmUpload,
  requestDownloadUrl,
  scanWebhook,
} from "../src/controllers/kycController";
import { prisma } from "../src/config/database";
import { AppError } from "../src/middleware/errorHandler";
import {
  generateUploadUrl,
  generateDownloadUrl,
  markObjectClean,
  markObjectInfected,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  assertKeyOwnership,
} from "../src/services/storage/s3Service";
import { generateId } from "../src/utils/idGenerator";

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("../src/config/database", () => ({
  prisma: {
    kycDocument: {
      upsert: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    kycApplication: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("../src/config/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../src/config/env", () => ({
  config: {
    nodeEnv: "test",
    s3: {
      scanWebhookSecret: "test-webhook-secret",
    },
  },
}));

jest.mock("../src/services/storage/s3Service", () => ({
  ALLOWED_MIME_TYPES: {
    passport: ["image/jpeg", "image/png"],
    national_id: ["image/jpeg", "image/png"],
    selfie: ["image/jpeg"],
  },
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB
  generateUploadUrl: jest.fn(),
  generateDownloadUrl: jest.fn(),
  markObjectClean: jest.fn(),
  markObjectInfected: jest.fn(),
  assertKeyOwnership: jest.fn(),
}));

jest.mock("../src/utils/idGenerator", () => ({
  generateId: jest.fn(() => "generated-doc-id"),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    apiKey: { userId: "user-abc" },
    body: {},
    params: {},
    headers: {},
    ...overrides,
  } as any;
}

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// ── Test Suites ───────────────────────────────────────────────────────────────

describe("kycController.requestUploadUrl", () => {
  const baseBody = {
    document_kind: "passport",
    mime_type: "image/jpeg",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (generateUploadUrl as jest.Mock).mockResolvedValue({
      upload_url: "https://s3.example.com/upload",
      object_key: "user-abc/passport/generated-doc-id",
      content_type: "image/jpeg",
      expires_at: "2026-10-20T14:00:00Z",
    });
    (prisma.kycApplication.findFirst as jest.Mock).mockResolvedValue({ id: "app-001" });
    (prisma.kycDocument.upsert as jest.Mock).mockResolvedValue({
      id: "generated-doc-id",
      kind: "passport",
      createdAt: new Date("2026-10-20T13:00:00Z"),
    });
  });

  it("returns a presigned upload URL and document metadata", async () => {
    const req = makeReq({ body: baseBody });
    const res = makeRes();
    const next = jest.fn();

    await requestUploadUrl(req, res, next);

    expect(generateUploadUrl).toHaveBeenCalledWith(
      "user-abc",
      "passport",
      "generated-doc-id",
      "image/jpeg",
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        document_id: "generated-doc-id",
        upload_url: "https://s3.example.com/upload",
        content_type: "image/jpeg",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("uses a client-supplied document_id when provided", async () => {
    const docId = "550e8400-e29b-41d4-a716-446655440000";
    const req = makeReq({ body: { ...baseBody, document_id: docId } });
    const res = makeRes();
    const next = jest.fn();

    await requestUploadUrl(req, res, next);

    expect(generateUploadUrl).toHaveBeenCalledWith("user-abc", "passport", docId, "image/jpeg");
  });

  it("creates a new KYC application if none is pending", async () => {
    (prisma.kycApplication.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ countryCode: "NG" });
    (prisma.kycApplication.create as jest.Mock).mockResolvedValue({ id: "app-new" });

    const req = makeReq({ body: baseBody });
    const res = makeRes();
    const next = jest.fn();

    await requestUploadUrl(req, res, next);

    expect(prisma.kycApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-abc",
          status: "pending",
        }),
      }),
    );
  });

  it("returns 401 when no API key / userId is present", async () => {
    const req = makeReq({ apiKey: undefined });
    const res = makeRes();
    const next = jest.fn();

    await requestUploadUrl(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(401);
  });

  it("returns 400 for an invalid document_kind", async () => {
    const req = makeReq({ body: { document_kind: "selfie_video", mime_type: "video/mp4" } });
    const res = makeRes();
    const next = jest.fn();

    await requestUploadUrl(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(400);
  });

  it("returns 400 when mime_type is missing", async () => {
    const req = makeReq({ body: { document_kind: "passport" } });
    const res = makeRes();
    const next = jest.fn();

    await requestUploadUrl(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(400);
  });

  it("propagates storage-service errors to next()", async () => {
    (generateUploadUrl as jest.Mock).mockRejectedValue(new Error("S3 unavailable"));

    const req = makeReq({ body: baseBody });
    const res = makeRes();
    const next = jest.fn();

    await requestUploadUrl(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("kycController.confirmUpload", () => {
  const validChecksum = "a".repeat(64);
  const baseBody = { checksum: validChecksum, file_size_bytes: 1024 };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.kycDocument.findFirst as jest.Mock).mockResolvedValue({
      id: "doc-001",
      storageRef: "user-abc/passport/doc-001",
      application: { userId: "user-abc" },
    });
    (assertKeyOwnership as jest.Mock).mockReturnValue(undefined);
    (prisma.kycDocument.update as jest.Mock).mockResolvedValue({
      id: "doc-001",
      kind: "passport",
      storageRef: "user-abc/passport/doc-001",
      checksum: validChecksum,
      scanStatus: "pending",
      createdAt: new Date("2026-10-20T13:00:00Z"),
    });
  });

  it("records checksum and file size; returns document metadata", async () => {
    const req = makeReq({ body: baseBody, params: { id: "doc-001" } });
    const res = makeRes();
    const next = jest.fn();

    await confirmUpload(req, res, next);

    expect(prisma.kycDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "doc-001" },
        data: expect.objectContaining({
          checksum: validChecksum,
          fileSizeBytes: 1024,
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        document_id: "doc-001",
        checksum: validChecksum,
        scan_status: "pending",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when no userId", async () => {
    const req = makeReq({ apiKey: undefined, params: { id: "doc-001" }, body: baseBody });
    const res = makeRes();
    const next = jest.fn();

    await confirmUpload(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(401);
  });

  it("returns 404 when document does not exist", async () => {
    (prisma.kycDocument.findFirst as jest.Mock).mockResolvedValue(null);

    const req = makeReq({ body: baseBody, params: { id: "nonexistent" } });
    const res = makeRes();
    const next = jest.fn();

    await confirmUpload(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(404);
  });

  it("returns 403 when document belongs to a different user", async () => {
    (prisma.kycDocument.findFirst as jest.Mock).mockResolvedValue({
      id: "doc-001",
      storageRef: "user-xyz/passport/doc-001",
      application: { userId: "user-xyz" }, // different user
    });

    const req = makeReq({ body: baseBody, params: { id: "doc-001" } });
    const res = makeRes();
    const next = jest.fn();

    await confirmUpload(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(403);
  });

  it("returns 400 for an invalid checksum (wrong length)", async () => {
    const req = makeReq({
      body: { checksum: "tooshort", file_size_bytes: 1024 },
      params: { id: "doc-001" },
    });
    const res = makeRes();
    const next = jest.fn();

    await confirmUpload(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(400);
  });

  it("returns 400 when file_size_bytes exceeds MAX_FILE_SIZE_BYTES", async () => {
    const req = makeReq({
      body: { checksum: validChecksum, file_size_bytes: MAX_FILE_SIZE_BYTES + 1 },
      params: { id: "doc-001" },
    });
    const res = makeRes();
    const next = jest.fn();

    await confirmUpload(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("kycController.requestDownloadUrl", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.kycDocument.findFirst as jest.Mock).mockResolvedValue({
      id: "doc-001",
      storageRef: "user-abc/passport/doc-001",
      application: { userId: "user-abc" },
    });
    (generateDownloadUrl as jest.Mock).mockResolvedValue({
      download_url: "https://s3.example.com/download",
      expires_at: "2026-10-20T14:00:00Z",
      scan_status: "clean",
    });
  });

  it("returns a presigned download URL for a clean document", async () => {
    const req = makeReq({ params: { id: "doc-001" } });
    const res = makeRes();
    const next = jest.fn();

    await requestDownloadUrl(req, res, next);

    expect(generateDownloadUrl).toHaveBeenCalledWith("user-abc", "user-abc/passport/doc-001");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        document_id: "doc-001",
        download_url: "https://s3.example.com/download",
        scan_status: "clean",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when no userId", async () => {
    const req = makeReq({ apiKey: undefined, params: { id: "doc-001" } });
    const res = makeRes();
    const next = jest.fn();

    await requestDownloadUrl(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(401);
  });

  it("returns 404 when document is not found", async () => {
    (prisma.kycDocument.findFirst as jest.Mock).mockResolvedValue(null);

    const req = makeReq({ params: { id: "missing" } });
    const res = makeRes();
    const next = jest.fn();

    await requestDownloadUrl(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(404);
  });

  it("returns 403 when document belongs to a different user", async () => {
    (prisma.kycDocument.findFirst as jest.Mock).mockResolvedValue({
      id: "doc-001",
      storageRef: "user-xyz/passport/doc-001",
      application: { userId: "user-xyz" },
    });

    const req = makeReq({ params: { id: "doc-001" } });
    const res = makeRes();
    const next = jest.fn();

    await requestDownloadUrl(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(403);
  });

  it("surfaces virus-scan block errors as 422 (compliance flag)", async () => {
    (generateDownloadUrl as jest.Mock).mockRejectedValue(
      new Error("Download blocked: virus scan result is infected"),
    );

    const req = makeReq({ params: { id: "doc-001" } });
    const res = makeRes();
    const next = jest.fn();

    await requestDownloadUrl(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(422);
  });

  it("surfaces pending-scan block as 422", async () => {
    (generateDownloadUrl as jest.Mock).mockRejectedValue(
      new Error("Download blocked: pending scan not yet completed"),
    );

    const req = makeReq({ params: { id: "doc-001" } });
    const res = makeRes();
    const next = jest.fn();

    await requestDownloadUrl(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("kycController.scanWebhook (compliance flags / approval-rejection path)", () => {
  const secret = "test-webhook-secret";

  function hmacSignature(body: Record<string, unknown>) {
    const crypto = require("crypto");
    return crypto.createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex");
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (markObjectClean as jest.Mock).mockResolvedValue(undefined);
    (markObjectInfected as jest.Mock).mockResolvedValue(undefined);
    (prisma.kycDocument.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  });

  it("marks document clean and updates DB on a valid clean result", async () => {
    const body = { object_key: "user-abc/passport/doc-001", scan_result: "clean" };
    const req = makeReq({
      body,
      headers: { "x-scan-signature": hmacSignature(body) },
    });
    const res = makeRes();
    const next = jest.fn();

    await scanWebhook(req, res, next);

    expect(markObjectClean).toHaveBeenCalledWith("user-abc/passport/doc-001");
    expect(prisma.kycDocument.updateMany).toHaveBeenCalledWith({
      where: { storageRef: "user-abc/passport/doc-001" },
      data: { scanStatus: "clean" },
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true, scan_result: "clean" });
    expect(next).not.toHaveBeenCalled();
  });

  it("quarantines document and updates DB on an infected result (rejection/compliance path)", async () => {
    const body = {
      object_key: "user-abc/passport/doc-001",
      scan_result: "infected",
      threat_name: "EICAR-Test-File",
    };
    const req = makeReq({
      body,
      headers: { "x-scan-signature": hmacSignature(body) },
    });
    const res = makeRes();
    const next = jest.fn();

    await scanWebhook(req, res, next);

    expect(markObjectInfected).toHaveBeenCalledWith("user-abc/passport/doc-001");
    expect(prisma.kycDocument.updateMany).toHaveBeenCalledWith({
      where: { storageRef: "user-abc/passport/doc-001" },
      data: { scanStatus: "infected" },
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true, scan_result: "infected" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when X-Scan-Signature header is missing", async () => {
    const body = { object_key: "user-abc/passport/doc-001", scan_result: "clean" };
    const req = makeReq({ body, headers: {} });
    const res = makeRes();
    const next = jest.fn();

    await scanWebhook(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(401);
  });

  it("returns 401 when HMAC signature is tampered (wrong secret)", async () => {
    const body = { object_key: "user-abc/passport/doc-001", scan_result: "clean" };
    const crypto = require("crypto");
    const badSig = crypto
      .createHmac("sha256", "wrong-secret")
      .update(JSON.stringify(body))
      .digest("hex");

    const req = makeReq({ body, headers: { "x-scan-signature": badSig } });
    const res = makeRes();
    const next = jest.fn();

    await scanWebhook(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(401);
  });

  it("returns 401 when HMAC signature covers a different body (replay / tampering)", async () => {
    const realBody = { object_key: "user-abc/passport/doc-001", scan_result: "clean" };
    const altBody = { object_key: "user-abc/passport/doc-001", scan_result: "infected" };
    const sig = hmacSignature(altBody); // signed for a different payload

    const req = makeReq({ body: realBody, headers: { "x-scan-signature": sig } });
    const res = makeRes();
    const next = jest.fn();

    await scanWebhook(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(401);
  });

  it("returns 400 for an unknown scan_result value", async () => {
    const body = { object_key: "user-abc/passport/doc-001", scan_result: "unknown_status" };
    const req = makeReq({
      body,
      headers: { "x-scan-signature": hmacSignature(body) },
    });
    const res = makeRes();
    const next = jest.fn();

    await scanWebhook(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(400);
  });

  it("returns 400 when object_key is missing", async () => {
    const body = { scan_result: "clean" };
    const req = makeReq({
      body,
      headers: { "x-scan-signature": hmacSignature(body) },
    });
    const res = makeRes();
    const next = jest.fn();

    await scanWebhook(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("KYC controller — integration: application status flow", () => {
  /**
   * These tests exercise the getOrCreateApplication helper indirectly through
   * requestUploadUrl, verifying that the KYC application lifecycle is tracked
   * correctly for compliance (pending → submitted stages).
   */

  beforeEach(() => {
    jest.clearAllMocks();
    (generateUploadUrl as jest.Mock).mockResolvedValue({
      upload_url: "https://s3.example.com/upload",
      object_key: "user-abc/national_id/new-doc",
      content_type: "image/jpeg",
      expires_at: "2026-10-20T14:00:00Z",
    });
    (prisma.kycDocument.upsert as jest.Mock).mockResolvedValue({
      id: "new-doc",
      kind: "national_id",
      createdAt: new Date("2026-10-20T13:00:00Z"),
    });
  });

  it("reuses an existing pending application rather than creating a duplicate", async () => {
    (prisma.kycApplication.findFirst as jest.Mock).mockResolvedValue({ id: "existing-app" });

    const req = makeReq({
      body: { document_kind: "national_id", mime_type: "image/jpeg" },
    });
    const res = makeRes();
    const next = jest.fn();

    await requestUploadUrl(req, res, next);

    expect(prisma.kycApplication.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-abc",
          status: expect.objectContaining({ in: expect.arrayContaining(["pending"]) }),
        }),
      }),
    );
    expect(prisma.kycApplication.create).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("creates a new application when none exists, using user countryCode", async () => {
    (prisma.kycApplication.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ countryCode: "KE" });
    (prisma.kycApplication.create as jest.Mock).mockResolvedValue({ id: "brand-new-app" });

    const req = makeReq({
      body: { document_kind: "national_id", mime_type: "image/jpeg" },
    });
    const res = makeRes();
    const next = jest.fn();

    await requestUploadUrl(req, res, next);

    expect(prisma.kycApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-abc",
          countryCode: "KE",
          status: "pending",
          feePaidAcbu: 0,
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("falls back to 'XX' countryCode when user has no countryCode set", async () => {
    (prisma.kycApplication.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ countryCode: null });
    (prisma.kycApplication.create as jest.Mock).mockResolvedValue({ id: "fallback-app" });

    const req = makeReq({
      body: { document_kind: "national_id", mime_type: "image/jpeg" },
    });
    const res = makeRes();
    const next = jest.fn();

    await requestUploadUrl(req, res, next);

    expect(prisma.kycApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          countryCode: "XX",
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
