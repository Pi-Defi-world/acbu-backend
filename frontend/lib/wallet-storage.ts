import localforage from 'localforage';
import { getPasscode } from './passcode-manager';

localforage.config({
  name: 'ACBU_Wallet',
  storeName: 'wallet_store',
});

const KEY_STORE_PREFIX = 'stellar_secret_';
// Legacy dev-only plaintext slots. Never written anymore and never read for
// signing; only cleaned up by removeStoredWallet.
//
// Wore 10: the old dev fallback mirrored the secret to plaintext localStorage
// and could be retrieved by stellar address alone. These prefixes are kept only
// so the cleanup path can purge any stale copies from existing installs.
// The address-keyed slot is the most sensitive one and must never be read.
const KEY_STORE_PLAINTEXT_PREFIX = 'stellar_secret_plain_';
const KEY_STORE_PLAINTEXT_ADDRESS_PREFIX = 'stellar_secret_plain_addr_';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const SALT_SIZE = 16;
const IV_SIZE = 12;
const PBKDF2_ITERATIONS = 200_000;

export interface EncryptedWalletPayload {
  version: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

function toBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(passcode: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(passcode),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptSecret(secret: string, passcode: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));
  const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
  const key = await deriveKey(passcode, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    textEncoder.encode(secret),
  );

  const payload: EncryptedWalletPayload = {
    version: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
  return JSON.stringify(payload);
}

async function decryptSecret(encrypted: string, passcode: string): Promise<string | null> {
  try {
    if (!encrypted) return null;
    const payload = JSON.parse(encrypted) as EncryptedWalletPayload;
    if (
      !payload ||
      typeof payload !== 'object' ||
      payload.version !== 1 ||
      typeof payload.salt !== 'string' ||
      typeof payload.iv !== 'string' ||
      typeof payload.ciphertext !== 'string'
    ) {
      return null;
    }

    const salt = fromBase64(payload.salt);
    const iv = fromBase64(payload.iv);
    const ciphertext = fromBase64(payload.ciphertext);
    const key = await deriveKey(passcode, salt);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      ciphertext as unknown as BufferSource,
    );
    return textDecoder.decode(decrypted);
  } catch {
    return null;
  }
}

export async function storeWalletSecret(userId: string, secret: string, passcode: string): Promise<void> {
  if (!userId) return;
  const encrypted = await encryptSecret(secret, passcode);
  await localforage.setItem(`${KEY_STORE_PREFIX}${userId}`, encrypted);
  // Never mirror the secret to plaintext localStorage. Purge any legacy copies
  // that may still be present from earlier dev builds.
  await clearLegacyPlaintextSlots(userId);
}

export async function getWalletSecret(userId: string, passcode: string): Promise<string | null> {
  if (!userId || !passcode) return null;
  const encrypted = await localforage.getItem<string>(` ${KEY_STORE_PREFIX}${userId}`);
  if (!encrypted) return null;
  
  return await decryptSecret(encrypted, passcode);
}

/**
 * Wallet secret lookup for client-side signing.
 * Decrypts the encrypted slot written by storeWalletSecret during onboarding,
 * using the passcode passed in or the one held in memory since sign-in.
 * Returns null when no wallet is stored or no passcode is available.
 *
 * The `_stellarAddress` parameter is ignored on purpose: plaintext lookups
 * by address are no longer performed and the legacy address-keyed slot is
 * purged by removeStoredWallet.
 */
export async function getWalletSecretAnyLocal(
  userId: string,
  _stellarAddress?: string | null,
  passcode?: string | null,
): Promise<string | null> {
  if (!userId) return null;
  try {
    const activePasscode = passcode ?? getPasscode();
    if (activePasscode) {
      const decrypted = await getWalletSecret(userId, activePasscode);
      if (decrypted) return decrypted;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function hasStoredWallet(userId: string): Promise<boolean> {
  if (!userId) return false;
  const encrypted = await localforage.getItem<string>(`${KEY_STORE_PREFIX}${userId}`);
  return !!encrypted;
}

/**
 * Remove every storage slot associated with the user, including legacy
 * plaintext copies in localStorage and in the localforage store.
 */
export async function removeStoredWallet(userId: string): Promise<void> {
  if (!userId) return;
  await localforage.removeItem(`${KEY_STORE_PREFIX}${userId}`);
  await localforage.removeItem(`${KEY_STORE_PLAINTEXT_PREFIX}${userId}`);
  await localforage.removeItem(`${KEY_STORE_PLAINTEXT_ADDRESS_PREFIX}${userId}`);
  await clearLegacyPlaintextSlots(userId);
}

/**
 * Purge legacy dev-plaintext slots from both localforage and
 * window.localStorage. The old dev fallback wrote to `localStorage` with
 * both a user-id key and an address-keyed key, so we clear both forms.
 */
async function clearLegacyPlaintextSlots(userId: string): Promise<void> {
  if (!userId) return;
  const keys = [
    `${KEY_STORE_PLAINTEXT_PREFIX}${userId}`,
    `${KEY_STORE_PLAINTEXT_ADDRESS_PREFIX}${userId}`,
  ];
  if (typeof window !== 'undefined' && window.localStorage) {
    for (const key of keys) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // ignore storage access errors (e.g. private mode)
      }
    }
  }
}
