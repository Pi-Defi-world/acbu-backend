/**
 * Cryptographically secure OTP generation.
 *
 * Math.random() is a non-reseeding xorshift PRNG whose internal state is
 * fully algebraically recoverable from a handful of observed outputs.  Any
 * OTP backed by it — login 2FA, account-recovery unlock — is trivially
 * predictable once an attacker observes a few consecutive codes.
 *
 * crypto.randomInt(min, max) is seeded from the OS CSPRNG and is safe for
 * security-sensitive values.  Both Node.js built-in and Web Crypto spell it
 * the same way, so no extra dependency is needed.
 *
 * The range [100_000, 1_000_000) produces exactly 6-digit codes with uniform
 * distribution (900 000 possible values, same as the old Math.floor approach
 * but without the bias or predictability).
 */
import { randomInt } from "crypto";

const OTP_MIN = 100_000; // inclusive
const OTP_MAX = 1_000_000; // exclusive — gives 6-digit codes: 100000–999999

/**
 * Generate a cryptographically secure 6-digit OTP code.
 *
 * @returns A string of exactly 6 decimal digits, e.g. "482031".
 */
export function generateSecureOtp(): string {
  return String(randomInt(OTP_MIN, OTP_MAX));
}
