import { describe, it, expect, beforeEach } from "vitest";
import {
  setPasscode,
  getPasscode,
  clearPasscode,
  hasPasscode,
  setTempPassphrase,
  getTempPassphrase,
  clearTempPassphrase,
} from "../passcode-manager";

describe("passcode-manager", () => {
  beforeEach(() => {
    clearPasscode();
    clearTempPassphrase();
  });

  it("setPasscode / getPasscode / hasPasscode / clearPasscode work without ReferenceError", () => {
    expect(hasPasscode()).toBe(false);
    expect(getPasscode()).toBeNull();

    expect(() => setPasscode("secret-123")).not.toThrow();
    expect(hasPasscode()).toBe(true);
    expect(getPasscode()).toBe("secret-123");

    expect(() => clearPasscode()).not.toThrow();
    expect(hasPasscode()).toBe(false);
    expect(getPasscode()).toBeNull();
  });

  it("does not expose passcodeHolder on the module exports", async () => {
    const mod = await import("../passcode-manager");
    expect(Object.keys(mod)).not.toContain("passcodeHolder");
    expect((mod as Record<string, unknown>).passcodeHolder).toBeUndefined();
  });

  it("temp passphrase helpers store and clear in memory", () => {
    expect(getTempPassphrase()).toBeNull();
    setTempPassphrase("SSECRETKEY");
    expect(getTempPassphrase()).toBe("SSECRETKEY");
    clearTempPassphrase();
    expect(getTempPassphrase()).toBeNull();
  });

  it("never persists the passcode or temp passphrase to web storage (#994)", () => {
    sessionStorage.clear();
    localStorage.clear();

    setPasscode("secret-123");
    setTempPassphrase("SSECRETKEY");

    const dump = (storage: Storage) =>
      Array.from(
        { length: storage.length },
        (_, i) => `${storage.key(i)}=${storage.getItem(storage.key(i)!)}`,
      ).join(";");

    const stored = `${dump(sessionStorage)}|${dump(localStorage)}`;

    expect(stored).not.toContain("secret-123");
    expect(stored).not.toContain("SSECRETKEY");
    expect(stored).not.toContain("PASSCODE_KEY");
  });
});
