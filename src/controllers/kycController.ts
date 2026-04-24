/**
 * KYC Document Controller — B-062
 *
 * Endpoints:
 *  POST   /kyc/documents/upload-url   — request a presigned PUT URL
 *  POST   /kyc/documents/:id/confirm  — confirm upload complete, record in DB
 *  GET    /kyc/documents/:id/download-url — request a presigned GET URL
 *  POST   /kyc/scan-webhook           — virus-scanner callback (HMAC-verified)
 */

import { Response, NextFunction } from "express";
import { z } from "zod";
import crypto from "crypto";
import { AuthRequest } from "../middleware/auth";
import { prisma } from "../config/database";
import { AppError } from "../middleware/errorHandler";
import { logger } from "../config/logger";
import { config } from "../config/env";
import {
  generateUploadUrl,
  generateDownloadUrl,
  markObjectClean,
  markObjectInfected,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  assertKeyOwnership,
} from "../services/storage/s3Service";

// ── Schemas ───────────────────────────────────────────────────────────────────

const requestUploadUrlSchema = z.object({
  document_kind: z.enum(
    Object.keys(ALLOWED_MIME_TYPES) as [string, ...string[]],
  ),
  mime_type: z.string().min(1).max(100),
  /** Optional: client-supplied document ID (UUID). Server generates one if omitted. */
  document_id: z.string().uuid().optional(),
});

const confirmUploadSchema = z.object({
  /** SHA-256 checksum of the uploaded file (hex). Stored for integrity auditing. */
  checksum: z
    .string()
    .regex(/^[a-f0-9]{64}$/, "Must be a 64-char hex SHA-256 checksum"),
  /** File size in bytes — must not exceed MAX_FILE_SIZE_BYTES. */
  file_size_bytes: z.number().int().positive().max(MAX_FILE_SIZE_BYTES),
});

const scanWebhookSchema = z.object({
  object_key: z.string().min(1),
  scan_result: z.enum(["clean", "infected"]),
  threat_name: z.string().optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Resolve or create the pending KYC application for a user. */
async function getOrCreateApplication(userId: string) {
  const existing = await prisma.kycApplication.findFirst({
    where: { userId, status: { in: ["pending", "submitted"] } },
    select: { id: true },
  });
  if (existing) return existing;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { countryCode: true },
  });

  return prisma.kycApplication.create({
    data: {
      userId,
      countryCode: user?.countryCode ?? "XX",
      status: "pending",
      feePaidAcbu: 0,
    },
    select: { id: true },
  });
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * POST /kyc/documents/upload-url
 *
 * Returns a short-lived presigned PUT URL. The client must:
 *  1. PUT the file to `upload_url` with the exact `content_type` header.
 *  2. Call POST /kyc/documents/:id/confirm once the upload completes.
 */
export async function requestUploadUrl(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);

    const body = requestUploadUrlSchema.parse(req.body);

    // Generate a document ID if not provided
    const documentId =
      body.document_id ??
      crypto.randomUUID();

    const result = await generateUploadUrl(
      userId,
      body.document_kind,
      documentId,
      body.mime_type,
    );

    // Pre-create the KycDocument record so we can track it before the upload
    const application = await getOrCreateApplication(userId);

    const doc = await prisma.kycDocument.upsert({
      where: { id: documentId },
      create: {
        id: documentId,
        applicationId: application.id,
        kind: body.document_kind,
        storageRef: result.object_key,
        mimeType: body.mime_type,
      },
      update: {
        storageRef: result.object_key,
        mimeType: body.mime_type,
      },
      select: { id: true, kind: true, createdAt: true },
    });

    logger.info("KYC upload URL issued", {
      userId,
      documentId: doc.id,
      documentKind: body.document_kind,
      expiresAt: result.expires_at,
    });

    res.status(200).json({
      document_id: doc.id,
      upload_url: result.upload_url,
      object_key: result.object_key,
      content_type: result.content_type,
      expires_at: result.expires_at,
      max_file_size_bytes: MAX_FILE_SIZE_BYTES,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return next(new AppError(e.errors.map((x) => x.message).join("; "), 400));
    }
    next(e);
  }
}

/**
 * POST /kyc/documents/:id/confirm
 *
 * Called after the client has successfully PUT the file to S3.
 * Records the checksum and file size for integrity auditing.
 */
export async function confirmUpload(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);

    const { id } = req.params;
    const body = confirmUploadSchema.parse(req.body);

    // Verify the document belongs to this user
    const doc = await prisma.kycDocument.findFirst({
      where: { id },
      include: { application: { select: { userId: true } } },
    });

    if (!doc) throw new AppError("Document not found", 404);
    if (doc.application.userId !== userId) {
      throw new AppError("Access denied", 403);
    }

    // Verify the storage key is scoped to this user (defence in depth)
    assertKeyOwnership(doc.storageRef, userId);

    const updated = await prisma.kycDocument.update({
      where: { id },
      data: {
        checksum: body.checksum,
        fileSizeBytes: body.file_size_bytes,
      },
      select: { id: true, kind: true, storageRef: true, checksum: true, scanStatus: true, createdAt: true },
    });

    logger.info("KYC document upload confirmed", {
      userId,
      documentId: id,
      checksum: body.checksum,
      fileSizeBytes: body.file_size_bytes,
    });

    res.status(200).json({
      document_id: updated.id,
      kind: updated.kind,
      checksum: updated.checksum,
      scan_status: updated.scanStatus,
      created_at: updated.createdAt.toISOString(),
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return next(new AppError(e.errors.map((x) => x.message).join("; "), 400));
    }
    next(e);
  }
}

/**
 * GET /kyc/documents/:id/download-url
 *
 * Returns a short-lived presigned GET URL.
 * Blocked if the virus scan has not passed.
 */
export async function requestDownloadUrl(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);

    const { id } = req.params;

    const doc = await prisma.kycDocument.findFirst({
      where: { id },
      include: { application: { select: { userId: true } } },
    });

    if (!doc) throw new AppError("Document not found", 404);
    if (doc.application.userId !== userId) {
      throw new AppError("Access denied", 403);
    }

    const result = await generateDownloadUrl(userId, doc.storageRef);

    res.status(200).json({
      document_id: id,
      download_url: result.download_url,
      expires_at: result.expires_at,
      scan_status: result.scan_status,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return next(new AppError(e.errors.map((x) => x.message).join("; "), 400));
    }
    // Surface scan-gate errors as 422 so clients can distinguish from 500
    if (
      e instanceof Error &&
      (e.message.includes("virus scan") || e.message.includes("pending scan"))
    ) {
      return next(new AppError(e.message, 422));
    }
    next(e);
  }
}

/**
 * POST /kyc/scan-webhook
 *
 * Receives virus-scan results from the scanner (Lambda / ClamAV sidecar).
 * Authenticated via HMAC-SHA256 signature in `X-Scan-Signature` header.
 *
 * Expected body: { object_key, scan_result: "clean"|"infected", threat_name? }
 */
export async function scanWebhook(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // ── HMAC verification ────────────────────────────────────────────────────
    const secret = config.s3.scanWebhookSecret;
    if (secret) {
      const signature = req.headers["x-scan-signature"];
      if (!signature || typeof signature !== "string") {
        throw new AppError("Missing scan webhook signature", 401);
      }
      const rawBody = JSON.stringify(req.body);
      const expected = crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex");
      const sigBuffer = Buffer.from(signature, "hex");
      const expBuffer = Buffer.from(expected, "hex");
      if (
        sigBuffer.length !== expBuffer.length ||
        !crypto.timingSafeEqual(sigBuffer, expBuffer)
      ) {
        throw new AppError("Invalid scan webhook signature", 401);
      }
    } else if (config.nodeEnv === "production") {
      // In production the secret MUST be configured
      throw new AppError("Scan webhook secret not configured", 500);
    }

    const body = scanWebhookSchema.parse(req.body);

    if (body.scan_result === "clean") {
      await markObjectClean(body.object_key);
      // Sync scan status to DB so download handler can read it without an S3 round-trip
      await prisma.kycDocument.updateMany({
        where: { storageRef: body.object_key },
        data: { scanStatus: "clean" },
      });
    } else {
      await markObjectInfected(body.object_key);
      await prisma.kycDocument.updateMany({
        where: { storageRef: body.object_key },
        data: { scanStatus: "infected" },
      });
      logger.warn("Infected KYC document quarantined", {
        objectKey: body.object_key,
        threatName: body.threat_name,
      });
    }

    res.status(200).json({ ok: true, scan_result: body.scan_result });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return next(new AppError(e.errors.map((x) => x.message).join("; "), 400));
    }
    next(e);
  }
}
