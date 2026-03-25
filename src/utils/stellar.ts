/**
 * Stellar address validation utilities.
 *
 * Stellar public keys (G-addresses) are 56-character base32-encoded strings
 * starting with 'G'. This module provides validation to prevent invalid
 * addresses from entering the database or being used in transactions.
 */
import { StrKey } from "stellar-sdk";

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
 * Assert that an address is a valid Stellar public key or throw.
 */
export function assertValidStellarAddress(address: string): void {
  if (!isValidStellarAddress(address)) {
    throw new Error(
      `Invalid Stellar address format: must be a 56-character G-address, got "${address?.slice(0, 8) ?? "(empty)"}..."`,
    );
  }
}
