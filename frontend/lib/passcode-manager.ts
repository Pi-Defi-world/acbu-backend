/**
 * Secure passcode manager for wallet operations.
 *
 * SECURITY NOTE: Passcode is stored in memory only, not in sessionStorage.
 * This reduces XSS attack surface while maintaining usability.
 *
 * The passcode is needed to decrypt wallet secrets stored in IndexedDB.
 * It's cleared on logout or page refresh (user must re-authenticate).
 */

// Passcode is stored in a closure, not on the module scope.
// Prevents XSS payloads from accessing the passcode via window/globalThis
// or module monkey-patching.
const passcodeHolder = (() => {
  let passcode: string | null = null;
  return {
    set(pass: string) {
      passcode = pass;
    },
    get() {
      return passcode;
    },
    clear() {
      passcode = null;
    },
    has() {
      return passcode !== null;
    },
  };
})();

let inMemoryTempPassphrase: string | null = null;

/**
 * Store passcode in memory for the current session.
 * This reduces XSS attack surface by avoiding persistent storage,
 * though active XSS can still access it while in memory.
 */
export function setPasscode(passcode: string): void {
  passcodeHolder.set(passcode);
}

/**
 * Get the stored passcode from memory.
 */
export function getPasscode(): string | null {
  return passcodeHolder.get();
}

/**
 * Clear the passcode from memory.
 * Called on logout or when user explicitly clears it.
 */
export function clearPasscode(): void {
  passcodeHolder.clear();
}

/**
 * Check if passcode is available in memory.
 */
export function hasPasscode(): boolean {
  return passcodeHolder.has();
}

/**
 * Store the backend-generated wallet passphrase in memory only.
 * Never written to sessionStorage/localStorage to prevent XSS exfiltration.
 * Cleared after wallet setup completes or on logout/refresh.
 */
export function setTempPassphrase(passphrase: string): void {
  inMemoryTempPassphrase = passphrase;
}

export function getTempPassphrase(): string | null {
  return inMemoryTempPassphrase;
}

export function clearTempPassphrase(): void {
  inMemoryTempPassphrase = null;
}
