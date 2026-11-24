import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database";
import { logger } from "../../config/logger";

/**
 * Tombstone delete a user account with all associated data.
 *
 * This service performs the following operations in a single transaction:
 * 1. Delete all API keys for the user
 * 2. Delete all OTP challenges
 * 3. Delete all user passkeys
 * 4. Delete all user contacts (as both sender and recipient)
 * 5. Delete all guardians (as both user and guardian)
 * 6. Update the user record with tombstone data (anonymized fields)
 *
 * @param userId - The ID of the user to tombstone delete
 * @param source - The source of the deletion (for logging purposes)
 * @throws {Error} If the transaction fails
 */
export async function tombstoneDeleteUser(
  userId: string,
  source: "deleteMe" | "deleteAccount" = "deleteAccount",
): Promise<void> {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

  const logSource =
    source === "deleteMe"
      ? "Account tombstone deleted (legacy endpoint)"
      : "Account tombstone deleted";
  logger.info(logSource, { userId });
}
