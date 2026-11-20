/**
 * Poseidon2 hash helpers using @aztec/bb.js single-threaded WASM.
 *
 * These compute the same values as the Noir circuit's
 * `poseidon2_hash_2` and `poseidon2_hash_4` functions.
 *
 * The frontend pre-computes commitment and nullifier before
 * feeding them as public inputs into the Noir prover.
 */

import { BarretenbergSync, Fr } from "@aztec/bb.js";

let bb: BarretenbergSync | null = null;

async function getBb(): Promise<BarretenbergSync> {
  if (!bb) {
    // bb.js 0.87.0 exposes a singleton constructor (`new` is private).
    bb = await BarretenbergSync.initSingleton();
  }
  return bb;
}

/**
 * Compute Poseidon2 hash of 2 field elements.
 */
export async function poseidon2Hash2(a: bigint, b: bigint): Promise<bigint> {
  const bb = await getBb();
  const fields = [new Fr(a), new Fr(b)];
  const hash = bb.poseidon2Hash(fields);
  return BigInt(hash.toString());
}

/**
 * Compute Poseidon2 hash of 4 field elements.
 */
export async function poseidon2Hash4(
  a: bigint,
  b: bigint,
  c: bigint,
  d: bigint
): Promise<bigint> {
  const bb = await getBb();
  const fields = [new Fr(a), new Fr(b), new Fr(c), new Fr(d)];
  const hash = bb.poseidon2Hash(fields);
  return BigInt(hash.toString());
}

/**
 * Compute the credential commitment from private data.
 */
export async function computeCommitment(cred: {
  kycLevel: number;
  countryCode: number;
  salt: bigint;
}): Promise<bigint> {
  return poseidon2Hash4(
    BigInt(cred.kycLevel),
    BigInt(cred.countryCode),
    cred.salt,
    0n
  );
}

/**
 * Compute the nullifier for a given commitment + salt.
 */
export async function computeNullifier(
  commitment: bigint,
  salt: bigint
): Promise<bigint> {
  return poseidon2Hash2(commitment, salt);
}

/** Encode a field element as an explicit, fixed-width big-endian value. */
export function fieldToBytes32(value: bigint): Uint8Array {
  if (value < 0n || value >= 1n << 256n) {
    throw new RangeError("Field element must fit in 32 bytes");
  }

  const encoded = new Uint8Array(32);
  let remaining = value;
  for (let index = encoded.length - 1; index >= 0; index -= 1) {
    encoded[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return encoded;
}

/**
 * Compute the attested credential binding hash (AZ-002).
 *
 * This is what the KYC authority attests alongside the commitment: the
 * circuit ties it to the same private credential via
 * `poseidon2_hash_2(kyc_level, country_code)`, so only credentials the
 * authority actually verified can be proven. The authority computes this
 * from its own verified records, never from user-claimed values.
 */
export async function computeAttestedCredential(cred: {
  kycLevel: number;
  countryCode: number;
}): Promise<bigint> {
  return poseidon2Hash2(BigInt(cred.kycLevel), BigInt(cred.countryCode));
}
