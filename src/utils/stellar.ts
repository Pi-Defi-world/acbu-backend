/**
 * Stellar address validation utilities.
 *
 * Stellar public keys (G-addresses) are 56-character base32-encoded strings
 * starting with 'G'. This module provides validation to prevent invalid
 * addresses from entering the database or being used in transactions.
 */
import { StrKey } from "@stellar/stellar-sdk";

/**
 * Validate that a string is a valid Stellar public key (G-address).
 *
 * Checks:
 *  1. Starts with 'G'
 *  2. Is exactly 56 characters
 *  3. Passes StrKey.isValidEd25519PublicKey (base32 checksum)
 */
export function isValidStellarAddress(address: string): boolean {
  if (!address || typeof address !== "string") return false;
  if (address.length !== 56) return false;
  if (!address.startsWith("G")) return false;
  return StrKey.isValidEd25519PublicKey(address);
}

/**
 * Known test/dummy addresses that pass the StrKey checksum but must never be
 * persisted as a real user wallet (B-013, #1313).
 */
const PLACEHOLDER_STELLAR_ADDRESS_PATTERNS = [
  /^G[A]{55}$/, // All A's
  /^G[B]{55}$/, // All B's
  /^G[0]{55}$/, // All zeros
  /^GTEST/,
  /^GDUMMY/,
  /^GPLACEHOLDER/,
  /^GXXXXXXXX/,
];

/**
 * Detect placeholder/dummy G-addresses. Kept in one place so the API, the
 * persistence scripts and the incident checks all agree on what is invalid.
 */
export function isPlaceholderStellarAddress(address: string): boolean {
  if (!address || typeof address !== "string") return true;
  // Anything that is not a G-address is a placeholder/invalid value (this is
  // exactly what the old signup helper wrote).
  if (!address.startsWith("G")) return true;
  return PLACEHOLDER_STELLAR_ADDRESS_PATTERNS.some((pattern) => pattern.test(address));
}

/**
 * A stored address is only usable when it is a real G-address and not a
 * placeholder. This is the predicate every write path must pass.
 */
export function isValidNonPlaceholderStellarAddress(address: string): boolean {
  return isValidStellarAddress(address) && !isPlaceholderStellarAddress(address);
}

/**
 * Defensive read-path sanitizer. Legacy rows (e.g. the old `P`-prefixed
 * placeholder written on signup) may still exist in production; callers must
 * treat them as "no wallet" instead of returning them to clients or passing
 * them to Stellar validation.
 */
export function sanitizeStellarAddress(address: string | null | undefined): string | null {
  if (!address || typeof address !== "string") return null;
  return isValidNonPlaceholderStellarAddress(address) ? address : null;
}

/**
 * Assert that an address is a valid Stellar public key or throw.
 */
export function assertValidStellarAddress(address: string): void {
  if (!isValidStellarAddress(address)) {
    throw new Error(
      `Invalid Stellar address format: must be a 56-character G-address, got "${address?.slice(0, 8) ?? "(empty)"}..."`,
    );
  }
}

/**
 * Validate a recipient account for minting and redemption.
 *
 * Only Stellar account public keys (G-addresses) are valid recipients.
 * Contract addresses (C-addresses) cannot hold redeemed underlying assets
 * and must not be accepted as recipient accounts.
 */
export function isValidRecipientAccount(address: string): boolean {
  return isValidStellarAddress(address);
}

export function assertValidRecipientAccount(address: string): void {
  if (!isValidRecipientAccount(address)) {
    throw new Error(
      `Invalid recipient account: must be a valid 56-character Stellar G-address, got "${address?.slice(0, 8) ?? "(empty)"}..."`,
    );
  }
}
