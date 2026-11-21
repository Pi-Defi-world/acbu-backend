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
