import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  setForceWalletSetup,
  readForceWalletSetupFlag,
  clearForceWalletSetupFlag,
} from "../force-wallet-setup";

const KEY = "force_wallet_setup";

describe("force-wallet-setup", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("returns false when the flag does not exist", () => {
    expect(readForceWalletSetupFlag()).toBe(false);
  });

  it("returns true while the flag is set and valid", () => {
    setForceWalletSetup();
    expect(localStorage.getItem(KEY)).not.toBeNull();
    expect(readForceWalletSetupFlag()).toBe(true);
  });

  it("returns false and removes the flag once it has expired", () => {
    vi.useFakeTimers();
    setForceWalletSetup();

    // Mid-life: still valid.
    vi.setSystemTime(Date.now() + 6 * 60 * 60 * 1000);
    expect(readForceWalletSetupFlag()).toBe(true);

    // After the expiry duration: stale.
    vi.setSystemTime(Date.now() + 12 * 60 * 60 * 1000);
    expect(readForceWalletSetupFlag()).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("clears the flag when explicitly cleared", () => {
    setForceWalletSetup();
    clearForceWalletSetupFlag();
    expect(readForceWalletSetupFlag()).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("treats a legacy plain 'true' value as stale and removes it", () => {
    localStorage.setItem(KEY, "true");
    expect(readForceWalletSetupFlag()).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("treats malformed data as stale and removes it without throwing", () => {
    localStorage.setItem(KEY, "{not valid json");
    expect(() => readForceWalletSetupFlag()).not.toThrow();
    expect(readForceWalletSetupFlag()).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();

    localStorage.setItem(
      KEY,
      JSON.stringify({ value: false, expiresAt: Date.now() + 1000 }),
    );
    expect(readForceWalletSetupFlag()).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();

    localStorage.setItem(KEY, JSON.stringify({ value: true }));
    expect(readForceWalletSetupFlag()).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
