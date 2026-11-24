import { encryptJson, decryptJson, getPiiKey } from "./piiEncryption";
import { config } from "../config/env";

function getKey(): Buffer | null {
  const hex = config.piiEncryptionKey;
  if (!hex) return null;
  try {
    return getPiiKey(hex);
  } catch {
    return null;
  }
}

export function encryptKycPayload(payload: unknown): string | null {
  if (payload == null) return null;
  const key = getKey();
  if (!key) {
    throw new Error("PII_ENCRYPTION_KEY not configured — refusing to store plaintext KYC payload");
  }
  return encryptJson(payload, key);
}

export function decryptKycPayload(encrypted: string | null): unknown {
  if (encrypted == null) return null;
  if (!encrypted.startsWith("v1:")) {
    try {
      return JSON.parse(encrypted);
    } catch {
      return encrypted;
    }
  }
  const key = getKey();
  if (!key) {
    throw new Error("PII_ENCRYPTION_KEY not configured — cannot decrypt KYC payload");
  }
  return decryptJson(encrypted, key);
}
