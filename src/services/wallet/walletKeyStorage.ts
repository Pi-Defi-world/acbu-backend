/**
 * Server-side storage rules for user wallet keys (W10-SEC-006).
 *
 * The backend only ever stores key material that the client encrypted with a
 * secret the backend never sees. There is deliberately no decryption function
 * in this module: any code path able to recover a user's Stellar secret turns
 * the platform back into a custodian, so a backend compromise would expose
 * every user's funds. See docs/WALLET_CUSTODY.md.
 */
import { StrKey } from "@stellar/stellar-sdk";
import { AppError } from "../../middleware/errorHandler";

/** Value stored in `User.keyEncryptionHint` for client-encrypted backups. */
export const CLIENT_WRAPPED_KEY_HINT = "client_wrapped";

/** `User.encryptedStellarSecret` is VARCHAR(512). */
export const MAX_WRAPPED_KEY_LENGTH = 512;

const MIN_WRAPPED_KEY_LENGTH = 1;
const MAX_METADATA_LENGTH = 64;

/** AES-GCM nonce (12) + auth tag (16) + at least one ciphertext byte. */
const MIN_WRAPPED_KEY_BYTES = 29;

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const SECRET_SEED_RE = /^S[A-Z2-7]{55}$/;

function isStellarSecretSeed(value: string): boolean {
  return SECRET_SEED_RE.test(value) && StrKey.isValidEd25519SecretSeed(value);
}

function assertMetadata(value: string, field: string): void {
  if (!value || value.length > MAX_METADATA_LENGTH) {
    throw new AppError(
      `${field} must be a non-empty string of at most ${MAX_METADATA_LENGTH} characters`,
      400,
    );
  }
}

/**
 * Validate a client-encrypted wallet backup before it is persisted.
 *
 * Rejects anything that still looks like recoverable key material, either raw
 * or base64-encoded, so a client bug cannot park a plaintext seed in the
 * database. The backend does not verify that the blob is encrypted — it simply
 * never receives the secret needed to open it.
 */
export function assertClientWrappedBackup(params: {
  wrappedKey: string;
  algorithm: string;
  kdf: string;
}): void {
  const { wrappedKey, algorithm, kdf } = params;

  assertMetadata(algorithm, "wrap_algorithm");
  assertMetadata(kdf, "wrap_kdf");

  if (wrappedKey.length < MIN_WRAPPED_KEY_LENGTH || wrappedKey.length > MAX_WRAPPED_KEY_LENGTH) {
    throw new AppError(
      `wrapped_key must be between ${MIN_WRAPPED_KEY_LENGTH} and ${MAX_WRAPPED_KEY_LENGTH} characters`,
      400,
    );
  }

  if (isStellarSecretSeed(wrappedKey)) {
    throw new AppError("Refusing to store unencrypted Stellar secret", 400);
  }

  if (!BASE64_RE.test(wrappedKey)) {
    throw new AppError("wrapped_key must be base64-encoded", 400);
  }

  const decoded = Buffer.from(wrappedKey, "base64");
  if (isStellarSecretSeed(decoded.toString("utf8"))) {
    throw new AppError("Refusing to store unencrypted Stellar secret", 400);
  }
  if (decoded.length < MIN_WRAPPED_KEY_BYTES) {
    throw new AppError("wrapped_key does not look like an encrypted wallet backup", 400);
  }
}
