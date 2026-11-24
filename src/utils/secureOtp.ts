import { randomInt } from "node:crypto";

const OTP_MIN = 100_000;
const OTP_MAX = 1_000_000;

/**
 * Generates a cryptographically secure 6-digit numeric OTP string using CSPRNG (crypto.randomInt).
 * Guarantees uniform distribution within [100000, 999999] for 2FA and account recovery.
 *
 * @returns {string} 6-digit OTP code string
 */
export function generateSecureOtp(): string {
  return String(randomInt(OTP_MIN, OTP_MAX));
}
