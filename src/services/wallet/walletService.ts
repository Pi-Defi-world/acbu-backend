/**
 * Wallet lifecycle: create keypair on first signin, store secret after user confirms encryption.
 */
import { Keypair } from "@stellar/stellar-sdk";
import { prisma } from "../../config/database";
import { logger } from "../../config/logger";
import { assertValidStellarAddress, isValidStellarAddress } from "../../utils/stellar";
import { AppError } from "../../middleware/errorHandler";

export interface EnsureWalletResult {
  wallet_created: boolean;
  passphrase?: string;
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
  // If stellarAddress is already set (either generated, imported, or external), do nothing
  if (user.stellarAddress != null) return { wallet_created: false };

  const keypair = Keypair.random();
  const publicKey = keypair.publicKey();
  const secretKey = keypair.secret();

  // Guard: ensure generated address is valid before persisting
  assertValidStellarAddress(publicKey);

  // Additional guard: reject any address that looks like a placeholder
  if (isPlaceholderAddress(publicKey)) {
    throw new Error("Generated address appears to be a placeholder");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { stellarAddress: publicKey },
  });
  logger.info("Wallet created for user", { userId, stellarAddress: publicKey });
  return { wallet_created: true, passphrase: secretKey };
}

/**
 * Check if an address looks like a common placeholder pattern.
 * This provides defense-in-depth against test/dummy addresses in production.
 */
function isPlaceholderAddress(address: string): boolean {
  if (!address || address.length !== 56) return true;
  
  // Common placeholder patterns
  const placeholderPatterns = [
    /^G[A]{55}$/,           // All A's (GAAAA...)
    /^G[B]{55}$/,           // All B's (GBBBB...)
    /^G[0]{55}$/,           // All zeros
    /^GTEST/,               // Starts with GTEST
    /^GDUMMY/,              // Starts with GDUMMY
    /^GPLACEHOLDER/,        // Starts with GPLACEHOLDER
    /^GXXXXXXXX/,           // Starts with GXXXXXXXX
  ];

  return placeholderPatterns.some(pattern => pattern.test(address));
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
    data: { stellarAddress },
  });
  
  logger.info("Stellar address set for user", { userId, stellarAddress });
}
