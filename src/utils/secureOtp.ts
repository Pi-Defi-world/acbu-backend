import { randomInt } from "node:crypto";

export function generateSecureOtp(): string {
  return String(randomInt(100000, 1000000));
}