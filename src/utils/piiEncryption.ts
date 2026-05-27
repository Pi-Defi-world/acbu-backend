import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION_PREFIX = "v1:";

/**
 * Derives a 32-byte Buffer from the configured PII_ENCRYPTION_KEY.
 * The env value must be a 64-character hex string (256 bits).
 */
export function getPiiKey(hexKey: string): Buffer {
  if (hexKey.length !== 64) {
    throw new Error(
      "PII_ENCRYPTION_KEY must be a 64-character hex string (32 bytes / 256 bits). " +
        `Got ${hexKey.length} characters.`,
    );
  }
  return Buffer.from(hexKey, "hex");
}

/**
 * Encrypts a UTF-8 string with AES-256-GCM.
 * Returns a versioned base64 string: "v1:<iv-hex>:<tag-hex>:<ciphertext-base64>".
 */
export function encryptField(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return (
    VERSION_PREFIX +
    iv.toString("hex") +
    ":" +
    tag.toString("hex") +
    ":" +
    encrypted.toString("base64")
  );
}

/**
 * Decrypts a value produced by encryptField.
 * Throws on tampered ciphertext (GCM auth tag mismatch).
 */
export function decryptField(encrypted: string, key: Buffer): string {
  if (!encrypted.startsWith(VERSION_PREFIX)) {
    throw new Error("Unsupported PII encryption version or unencrypted value.");
  }
  const parts = encrypted.slice(VERSION_PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted PII field.");
  }
  const [ivHex, tagHex, ciphertextB64] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag.slice(0, TAG_BYTES));
  return (
    decipher.update(ciphertext).toString("utf8") +
    decipher.final().toString("utf8")
  );
}

/**
 * Produces a deterministic HMAC-SHA256 search token for a plaintext value.
 * Use this to maintain unique-index lookups (e.g. phone, email) while keeping
 * the stored value encrypted. Store both the encrypted field AND its search token.
 *
 * Returns a 64-char hex string.
 */
export function searchToken(plaintext: string, key: Buffer): string {
  return createHmac("sha256", key).update(plaintext, "utf8").digest("hex");
}

/**
 * Encrypts a JSON-serialisable object.
 * Returns a versioned string suitable for storage in a Text/String DB column.
 */
export function encryptJson(value: unknown, key: Buffer): string {
  return encryptField(JSON.stringify(value), key);
}

/**
 * Decrypts a value produced by encryptJson and parses it back to an object.
 */
export function decryptJson<T = unknown>(encrypted: string, key: Buffer): T {
  return JSON.parse(decryptField(encrypted, key)) as T;
}

/**
 * Returns true when a stored value was produced by encryptField / encryptJson.
 * Callers can use this to handle a mix of legacy plaintext rows and encrypted rows
 * during a rolling migration.
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(VERSION_PREFIX);
}
