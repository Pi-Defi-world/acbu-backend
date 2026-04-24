import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth";
import { prisma } from "../config/database";
import { AppError } from "../middleware/errorHandler";
import { logger } from "../config/logger";
import crypto from "crypto";

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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        apiKeys: true,
        guardians: true,
        wardGuardians: true,
        kycApplications: true,
        kycValidators: true,
        onRampSwaps: true,
        otpChallenges: true,
        transactions: true,
        contacts: true,
        contactOf: true,
        passkeys: true,
        salaryBatches: true,
        salarySchedules: true,
      },
    });

    if (!user) {
      throw new AppError("User not found", 404);
    }

    // Omit sensitive backend secrets like encrypted keys and passcode hashes before export
    const { passcodeHash, encryptedStellarSecret, keyEncryptionHint, totpSecretEncrypted, ...safeUser } = user;

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

    await prisma.$transaction(async (tx: any) => {
      // 1. Delete associated sensitive records
      await tx.apiKey.deleteMany({ where: { userId } });
      await tx.otpChallenge.deleteMany({ where: { userId } });
      await tx.userPasskey.deleteMany({ where: { userId } });
      await tx.userContact.deleteMany({ where: { userId } });
      await tx.userContact.deleteMany({ where: { contactUserId: userId } });
      await tx.guardian.deleteMany({ where: { userId } });
      await tx.guardian.deleteMany({ where: { guardianUserId: userId } });

      // 2. Tombstone the User record
      const tombstoneSuffix = crypto.randomUUID().substring(0, 8);
      await tx.user.update({
        where: { id: userId },
        data: {
          username: `deleted_${tombstoneSuffix}`,
          email: null,
          phoneE164: null,
          stellarAddress: null,
          kycStatus: "deleted",
          encryptedStellarSecret: null,
          keyEncryptionHint: null,
          passcodeHash: null,
          twoFaMethod: null,
          totpSecretEncrypted: null,
          privacyHideFromSearch: true,
        },
      });
    });

    logger.info("Account tombstone deleted", { userId });

    res.status(204).send();
  } catch (e) {
    next(e);
  }
}
