/**
 * Wallet lifecycle: create keypair on first signin, store secret after user confirms encryption.
 */
import { Keypair } from "stellar-sdk";
import { prisma } from "../../config/database";
import { logger } from "../../config/logger";
import { assertValidStellarAddress } from "../../utils/stellar";

export interface EnsureWalletResult {
  wallet_created: boolean;
  passphrase?: string;
}

/**
 * If user has no wallet (encryptedStellarSecret is null), create keypair, set stellarAddress, return passphrase.
 * Caller must not persist passphrase; user copies it, then calls confirm with encryption.
 */
export async function ensureWalletForUser(
  userId: string,
): Promise<EnsureWalletResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, stellarAddress: true, encryptedStellarSecret: true },
  });
  if (!user) return { wallet_created: false };
  if (user.encryptedStellarSecret != null) return { wallet_created: false };

  const keypair = Keypair.random();
  const publicKey = keypair.publicKey();
  const secretKey = keypair.secret();

  // Guard: ensure generated address is valid before persisting
  assertValidStellarAddress(publicKey);

  await prisma.user.update({
    where: { id: userId },
    data: { stellarAddress: publicKey },
  });
  logger.info("Wallet created for user", { userId, stellarAddress: publicKey });
  return { wallet_created: true, passphrase: secretKey };
}
