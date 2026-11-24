// @vitest-environment node
// Real WebCrypto; jsdom typed arrays are cross-realm and rejected by Node's subtle.
import { describe, it, expect, beforeEach, vi } from "vitest";

const store = new Map<string, unknown>();

vi.mock("localforage", () => ({
  default: {
    config: vi.fn(),
    getItem: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    setItem: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return value;
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  },
}));

import {
  storeWalletSecret,
  getWalletSecret,
  getWalletSecretAnyLocal,
  hasStoredWallet,
  removeStoredWallet,
} from "../wallet-storage";
import { setPasscode, clearPasscode } from "../passcode-manager";

const USER_ID = "user-123";
const SECRET = "SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const PASSCODE = "Correct-Horse-9!";

describe("wallet-storage", () => {
  beforeEach(() => {
    store.clear();
    clearPasscode();
  });

  it("never persists the secret in plaintext", async () => {
    await storeWalletSecret(USER_ID, SECRET, PASSCODE);
    for (const value of store.values()) {
      expect(String(value)).not.toContain(SECRET);
    }
  });

  it("round-trips the secret with the right passcode", async () => {
    await storeWalletSecret(USER_ID, SECRET, PASSCODE);
    expect(await getWalletSecret(USER_ID, PASSCODE)).toBe(SECRET);
    expect(await getWalletSecret(USER_ID, "wrong-passcode")).toBeNull();
  });

  it("getWalletSecretAnyLocal decrypts with the in-memory passcode set at sign-in (AF-019)", async () => {
    await storeWalletSecret(USER_ID, SECRET, PASSCODE);
    setPasscode(PASSCODE);
    expect(await getWalletSecretAnyLocal(USER_ID, null)).toBe(SECRET);
  });

  it("getWalletSecretAnyLocal prefers an explicitly passed passcode", async () => {
    await storeWalletSecret(USER_ID, SECRET, PASSCODE);
    setPasscode("stale-passcode");
    expect(await getWalletSecretAnyLocal(USER_ID, null, PASSCODE)).toBe(SECRET);
  });

  it("getWalletSecretAnyLocal returns null without a passcode or stored wallet", async () => {
    expect(await getWalletSecretAnyLocal(USER_ID, null)).toBeNull();
    await storeWalletSecret(USER_ID, SECRET, PASSCODE);
    expect(await getWalletSecretAnyLocal(USER_ID, null)).toBeNull();
  });

  it("hasStoredWallet ignores legacy plaintext records that cannot be used for signing", async () => {
    store.set(`stellar_secret_plain_${USER_ID}`, SECRET);
    expect(await hasStoredWallet(USER_ID)).toBe(false);

    await storeWalletSecret(USER_ID, SECRET, PASSCODE);
    expect(await hasStoredWallet(USER_ID)).toBe(true);

    await removeStoredWallet(USER_ID);
    expect(await hasStoredWallet(USER_ID)).toBe(false);
    expect(store.size).toBe(0);
  });
});
