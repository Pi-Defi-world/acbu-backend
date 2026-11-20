/**
 * Wallet lifecycle: the client generates and keeps the keypair, the backend
 * binds the public address and an optional client-encrypted backup.
 */
import { prisma } from "../../config/database";
import { logger } from "../../config/logger";
import { assertValidStellarAddress, isValidStellarAddress } from "../../utils/stellar";
import { AppError } from "../../middleware/errorHandler";
import { updateWalletWithConcurrency } from "./walletStateService";
import { CLIENT_WRAPPED_KEY_HINT, assertClientWrappedBackup } from "./walletKeyStorage";

export interface WalletEnrollmentStatus {
  enrolled: boolean;
  stellar_address: string | null;
}

export interface EnrollWalletParams {
  stellarAddress: string;
  wrappedKey?: string;
  wrapAlgorithm?: string;
  wrapKdf?: string;
}

export async function assertUserWalletAddress(
  userId: string,
  providedAddress: string,
): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stellarAddress: true },
  });

  if (!user?.stellarAddress) {
    throw new AppError("User wallet address not set", 400);
  }

  // Validate stored address format (defense in depth)
  if (!isValidStellarAddress(user.stellarAddress)) {
    logger.error("Invalid stellar address format in database", {
      userId,
      stellarAddress: user.stellarAddress,
    });
    throw new AppError("Invalid wallet address format", 500);
  }

  if (user.stellarAddress !== providedAddress) {
    throw new AppError("Wallet address does not match user", 403);
  }

  return user.stellarAddress;
}

/**
 * Report whether a user has a wallet bound, without touching key material.
 * Signin uses this to tell the client to run its own key generation flow.
 */
export async function getWalletEnrollmentStatus(userId: string): Promise<WalletEnrollmentStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stellarAddress: true },
  });
  return { enrolled: Boolean(user?.stellarAddress), stellar_address: user?.stellarAddress ?? null };
}

/**
 * Bind a keypair the client generated to the user, with an optional
 * client-encrypted backup. The backend never generates, receives or stores a
 * usable private key: only the public address and an opaque blob it cannot
 * decrypt are persisted.
 */
export async function enrollClientGeneratedWallet(
  userId: string,
  ifMatch: string | undefined,
  params: EnrollWalletParams,
): Promise<number> {
  if (!isValidStellarAddress(params.stellarAddress)) {
    throw new AppError("Invalid stellar address: must be a valid Stellar public key", 400);
  }
  if (isPlaceholderAddress(params.stellarAddress)) {
    throw new AppError("Invalid stellar address: appears to be a placeholder", 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stellarAddress: true },
  });
  if (user?.stellarAddress && user.stellarAddress !== params.stellarAddress) {
    throw new AppError(
      "Wallet already enrolled; rotate the address with PUT /users/me/wallet",
      409,
    );
  }

  if (params.wrappedKey !== undefined) {
    assertClientWrappedBackup({
      wrappedKey: params.wrappedKey,
      algorithm: params.wrapAlgorithm ?? "",
      kdf: params.wrapKdf ?? "",
    });
  }

  const walletVersion = await updateWalletWithConcurrency(userId, ifMatch, {
    stellarAddress: params.stellarAddress,
    encryptedStellarSecret: params.wrappedKey ?? null,
    keyEncryptionHint: params.wrappedKey !== undefined ? CLIENT_WRAPPED_KEY_HINT : "external",
  });

  logger.info("Wallet enrolled from client-generated key", {
    userId,
    stellarAddress: params.stellarAddress,
    hasEncryptedBackup: params.wrappedKey !== undefined,
    walletVersion,
  });
  return walletVersion;
}

/**
 * Check if an address looks like a common placeholder pattern.
 * This provides defense-in-depth against test/dummy addresses in production.
 */
function isPlaceholderAddress(address: string): boolean {
  if (!address || address.length !== 56) return true;

  // Common placeholder patterns
  const placeholderPatterns = [
    /^G[A]{55}$/, // All A's (GAAAA...)
    /^G[B]{55}$/, // All B's (GBBBB...)
    /^G[0]{55}$/, // All zeros
    /^GTEST/, // Starts with GTEST
    /^GDUMMY/, // Starts with GDUMMY
    /^GPLACEHOLDER/, // Starts with GPLACEHOLDER
    /^GXXXXXXXX/, // Starts with GXXXXXXXX
  ];

  return placeholderPatterns.some((pattern) => pattern.test(address));
}

/**
 * Validate and set stellar address for a user (e.g., for imported wallets).
 * This is the ONLY function that should be used to set stellarAddress externally.
 */
export async function setStellarAddressForUser(
  userId: string,
  stellarAddress: string,
): Promise<void> {
  // Strict validation
  assertValidStellarAddress(stellarAddress);

  // Reject placeholders
  if (isPlaceholderAddress(stellarAddress)) {
    throw new AppError("Invalid stellar address: appears to be a placeholder", 400);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { stellarAddress, walletVersion: { increment: 1 } },
  });

  logger.info("Stellar address set for user", { userId, stellarAddress });
}
