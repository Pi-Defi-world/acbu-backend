import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { getAuditExports } from "../services/reports/reportService";
import { tombstoneDeleteUser } from "../services/user";

/**
 * GET /compliance/export
 * Retrieves all data associated with the authenticated user for GDPR export.
 */
export async function exportData(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) {
      throw new AppError("User-scoped API key required", 401);
    }

    const user = await getAuditExports(userId);

    if (!user) {
      throw new AppError("User not found", 404);
    }

    // Omit sensitive backend secrets like encrypted keys and passcode hashes before export
    const safeUser = { ...user };
    delete (safeUser as any).passcodeHash;
    delete (safeUser as any).encryptedStellarSecret;
    delete (safeUser as any).keyEncryptionHint;
    delete (safeUser as any).totpSecretEncrypted;

    res.json({
      export_timestamp: new Date().toISOString(),
      user: safeUser,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * DELETE /compliance/account
 * Performs a tombstone delete on the authenticated user's account.
 */
export async function deleteAccount(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) {
      throw new AppError("User-scoped API key required", 401);
    }

    await tombstoneDeleteUser(userId, "deleteAccount");

    res.status(204).send();
  } catch (e) {
    next(e);
  }
}
