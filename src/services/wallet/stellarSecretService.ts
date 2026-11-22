import crypto from "crypto";
import { prisma } from "../../config/database";

const WALLET_ENC_SALT_PREFIX = "acbu-wallet-v1:";
const WALLET_ENC_KEYLEN = 32;
const WALLET_ENC_IVLEN = 12;
const WALLET_ENC_ALGO = "aes-256-gcm";
const WALLET_ENC_AUTH_TAG_LEN = 16;

/**
 * Decrypt the user's Stellar secret seed using their passcode.
 *
 * Notes:
 * - Secrets are encrypted at rest in `User.encryptedStellarSecret` using AES-256-GCM.
 * - The key is derived via scrypt(passcode, "acbu-wallet-v1:<userId>", 32).
 */
export async function decryptUserStellarSecret(
  userId: string,
  passcode: string,
): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { encryptedStellarSecret: true, keyEncryptionHint: true },
  });
  if (!user?.encryptedStellarSecret) return null;
  if (user.keyEncryptionHint && user.keyEncryptionHint !== "passcode") return null;

  const blob = Buffer.from(user.encryptedStellarSecret, "base64");
  if (blob.length < WALLET_ENC_IVLEN + WALLET_ENC_AUTH_TAG_LEN) {
    throw new Error("Invalid encrypted wallet blob");
  }

  const iv = blob.subarray(0, WALLET_ENC_IVLEN);
  const authTag = blob.subarray(blob.length - WALLET_ENC_AUTH_TAG_LEN);
  const ciphertext = blob.subarray(WALLET_ENC_IVLEN, blob.length - WALLET_ENC_AUTH_TAG_LEN);

  const salt = WALLET_ENC_SALT_PREFIX + userId;
  const key = crypto.scryptSync(passcode, salt, WALLET_ENC_KEYLEN);
  const decipher = crypto.createDecipheriv(WALLET_ENC_ALGO, key, iv, {
    authTagLength: WALLET_ENC_AUTH_TAG_LEN,
  });
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  return plaintext;
}
