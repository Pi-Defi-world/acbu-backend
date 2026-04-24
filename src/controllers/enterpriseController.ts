import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { processBulkTransfer } from "../services/enterpriseService";

function getUploadedFile(
  req: Request,
):
  | { buffer: Buffer; originalname?: string; mimetype?: string; size?: number }
  | undefined {
  const anyReq = req as Request & {
    file?: {
      buffer?: Buffer;
      originalname?: string;
      mimetype?: string;
      size?: number;
    };
    files?: Array<{
      buffer?: Buffer;
      originalname?: string;
      mimetype?: string;
      size?: number;
    }>;
  };

  const file = anyReq.file ?? anyReq.files?.[0];
  if (!file?.buffer) {
    return undefined;
  }

  return file as { buffer: Buffer; originalname?: string; mimetype?: string; size?: number };
}

function isCsvUpload(file: {
  originalname?: string;
  mimetype?: string;
}): boolean {
  const name = file.originalname?.toLowerCase() ?? "";
  const mimetype = file.mimetype?.toLowerCase() ?? "";
  return (
    mimetype.includes("text/csv") ||
    mimetype.includes("text/plain") ||
    name.endsWith(".csv")
  );
}

/**
 * POST /enterprise/bulk-transfer
 * Process a bulk CSV transfer upload for an enterprise organization.
 */
export async function postBulkTransfer(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // TODO: bulk transfer (many transfers); idempotency; enterprise limits
    throw new AppError(
      "Bulk transfer endpoint not yet implemented. Use /transfers for single transfers.",
      501,
      "NOT_IMPLEMENTED",
    );

  } catch (e) {
    if (e instanceof AppError) {
      return next(e);
    }
    next(e);
  }
}

/**
 * GET /enterprise/treasury
 * Returns a stub treasury response until treasury aggregation is implemented.
 */
export async function getTreasury(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.status(200).json({
      totalBalance: null,
      byCurrency: [],
      message: "Treasury view not yet implemented.",
    });
  } catch (e) {
    next(e);
  }
}
