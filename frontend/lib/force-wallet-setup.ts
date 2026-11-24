/**
 * Temporary `force_wallet_setup` flag stored in localStorage.
 *
 * The flag is a short-lived navigation/state signal (e.g. set right before a
 * reload when the user removes their local wallet), not permanent application
 * state. It is therefore written with a timestamp-based expiry and is removed
 * automatically when read back after it has expired, is no longer valid, or
 * contains malformed data, so a stale flag can never trap the user in the
 * wallet setup flow.
 *
 * The value is stored as JSON so expiry metadata can be validated on read:
 *   { "value": true, "expiresAt": <epoch ms> }
 */

const FORCE_WALLET_SETUP_KEY = "force_wallet_setup";
const EXPIRY_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours

interface ForceWalletSetupValue {
  value: true;
  expiresAt: number;
}

/** Set the flag together with an expiry timestamp. */
export function setForceWalletSetup(): void {
  if (typeof window === "undefined") return;
  const payload: ForceWalletSetupValue = {
    value: true,
    expiresAt: Date.now() + EXPIRY_DURATION_MS,
  };
  try {
    localStorage.setItem(FORCE_WALLET_SETUP_KEY, JSON.stringify(payload));
  } catch {
    // Privacy modes / disabled storage can throw SecurityError
  }
}

/**
 * Read the flag. Returns `true` only while the persisted value is valid and
 * has not expired. Missing, legacy plain "true", expired, or malformed values
 * are treated as stale: the stored item is removed and `false` is returned so
 * a leftover flag can never permanently force the setup flow.
 */
export function readForceWalletSetupFlag(): boolean {
  if (typeof window === "undefined") return false;

  let raw: string | null;
  try {
    raw = localStorage.getItem(FORCE_WALLET_SETUP_KEY);
  } catch {
    // Privacy modes / disabled storage can throw SecurityError
    return false;
  }

  if (!isValidForceWalletSetupValue(raw)) {
    removeStoredFlag();
    return false;
  }

  const parsed = JSON.parse(raw as string) as ForceWalletSetupValue;

  if (Date.now() > parsed.expiresAt) {
    removeStoredFlag();
    return false;
  }

  return parsed.value;
}

/** Clear the flag. */
export function clearForceWalletSetupFlag(): void {
  if (typeof window === "undefined") return;
  removeStoredFlag();
}

function isValidForceWalletSetupValue(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as Partial<ForceWalletSetupValue>;
    return (
      parsed !== null &&
      typeof parsed === "object" &&
      parsed.value === true &&
      typeof parsed.expiresAt === "number" &&
      Number.isFinite(parsed.expiresAt)
    );
  } catch {
    return false;
  }
}

function removeStoredFlag(): void {
  try {
    localStorage.removeItem(FORCE_WALLET_SETUP_KEY);
  } catch {
    // Privacy modes / disabled storage can throw SecurityError
  }
}
