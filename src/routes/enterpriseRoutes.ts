import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { validateApiKey } from "../middleware/auth";
import {
  requireMinTier,
  requireSegmentScope,
} from "../middleware/segmentGuard";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";
import { AppError } from "../middleware/errorHandler";
import { config } from "../config/env";
import {
  postBulkTransfer,
  getTreasury,
} from "../controllers/enterpriseController";

const router: IRouter = Router();
const MAX_UPLOAD_SIZE_BYTES = config.bulkTransfer.maxFileSizeBytes;

type UploadFile = {
  buffer: Buffer;
  originalname?: string;
  mimetype?: string;
  size?: number;
};

function setUploadedFile(req: Request, file: UploadFile): void {
  (req as Request & { file?: UploadFile }).file = file;
}

function parseMultipartCsv(body: Buffer, boundary: string): UploadFile | null {
  const boundaryMarker = `--${boundary}`;
  const segments = body.toString("binary").split(boundaryMarker);

  for (const segment of segments) {
    if (!segment.includes("Content-Disposition")) {
      continue;
    }

    const headerEnd = segment.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      continue;
    }

    const rawHeaders = segment.slice(0, headerEnd);
    const rawContent = segment.slice(headerEnd + 4).replace(/\r\n--$/, "");
    const dispositionLine = rawHeaders
      .split("\r\n")
      .find((line) => line.toLowerCase().includes("content-disposition"));

    if (!dispositionLine || !dispositionLine.toLowerCase().includes('filename=')) {
      continue;
    }

    const filenameMatch = dispositionLine.match(/filename="?([^";]+)"?/i);
    const contentTypeLine = rawHeaders
      .split("\r\n")
      .find((line) => line.toLowerCase().includes("content-type"));
    const mimetype = contentTypeLine?.split(":")[1]?.trim() || "text/csv";

    const buffer = Buffer.from(rawContent, "binary");
    if (buffer.length > MAX_UPLOAD_SIZE_BYTES) {
      throw new AppError("Uploaded file exceeds size limit", 413);
    }

    return {
      buffer,
      originalname: filenameMatch?.[1] || "bulk-transfer.csv",
      mimetype,
      size: buffer.length,
    };
  }

  return null;
}

/**
 * Capture a CSV upload from either a raw text request or a simple multipart form upload.
 * Rejects uploads larger than the configured limit before controller processing begins.
 */
export function captureCsvUpload(req: Request, _res: Response, next: NextFunction): void {
  const existingFile = (req as Request & { file?: UploadFile }).file;
  if (existingFile?.buffer) {
    next();
    return;
  }

  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (
    !contentType.includes("text/csv") &&
    !contentType.includes("text/plain") &&
    !contentType.includes("multipart/form-data")
  ) {
    next();
    return;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  let finished = false;

  const finish = (error?: unknown) => {
    if (finished) {
      return;
    }
    finished = true;
    if (error) {
      next(error as Error);
      return;
    }
    next();
  };

  req.on("data", (chunk) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_UPLOAD_SIZE_BYTES) {
      finish(new AppError("Uploaded file exceeds size limit", 413));
      req.destroy();
      return;
    }
    chunks.push(buffer);
  });

  req.on("end", () => {
    const body = Buffer.concat(chunks);
    if (contentType.includes("multipart/form-data")) {
      const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
      const boundary = boundaryMatch?.[1]?.trim();
      if (!boundary) {
        finish(new AppError("Malformed multipart upload", 400));
        return;
      }
      const uploaded = parseMultipartCsv(body, boundary);
      if (uploaded) {
        setUploadedFile(req, uploaded);
      }
      finish();
      return;
    }

    const filename = String(req.headers["x-filename"] || "bulk-transfer.csv");
    const mimetype = contentType.includes("text/plain") ? "text/plain" : "text/csv";
    setUploadedFile(req, {
      buffer: body,
      originalname: filename,
      mimetype,
      size: body.length,
    });
    finish();
  });

  req.on("error", (error) => finish(error));
}

router.use(validateApiKey);
router.use(requireMinTier("enterprise"));
router.use(requireSegmentScope("enterprise:read", "enterprise:write"));
router.use(apiKeyRateLimiter);

router.post("/bulk-transfer", captureCsvUpload, postBulkTransfer);
router.get("/treasury", getTreasury);

export default router;
