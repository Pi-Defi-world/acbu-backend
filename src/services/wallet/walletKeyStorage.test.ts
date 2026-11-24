import { Keypair } from "@stellar/stellar-sdk";
import {
  CLIENT_WRAPPED_KEY_HINT,
  MAX_WRAPPED_KEY_LENGTH,
  assertClientWrappedBackup,
} from "./walletKeyStorage";

function wrapped(bytes: number): string {
  return Buffer.alloc(bytes, 5).toString("base64");
}

describe("assertClientWrappedBackup", () => {
  const metadata = { algorithm: "aes-256-gcm", kdf: "scrypt:N=16384,r=8,p=1" };

  it("accepts an opaque base64 backup of plausible size", () => {
    expect(() => assertClientWrappedBackup({ wrappedKey: wrapped(84), ...metadata })).not.toThrow();
  });

  it("documents client-wrapped storage in the hint it pairs with", () => {
    expect(CLIENT_WRAPPED_KEY_HINT).toBe("client_wrapped");
  });

  it("rejects a raw Stellar secret", () => {
    expect(() =>
      assertClientWrappedBackup({ wrappedKey: Keypair.random().secret(), ...metadata }),
    ).toThrow(/unencrypted Stellar secret/);
  });

  it("rejects a base64-encoded Stellar secret", () => {
    const seed = Keypair.random().secret();
    expect(() =>
      assertClientWrappedBackup({
        wrappedKey: Buffer.from(seed, "utf8").toString("base64"),
        ...metadata,
      }),
    ).toThrow(/unencrypted Stellar secret/);
  });

  it("rejects material that is not base64", () => {
    expect(() => assertClientWrappedBackup({ wrappedKey: "not base64!!", ...metadata })).toThrow(
      /base64/,
    );
  });

  it("rejects blobs larger than the storage column", () => {
    const oversized = `${"A".repeat(MAX_WRAPPED_KEY_LENGTH + 8)}=`;
    expect(() => assertClientWrappedBackup({ wrappedKey: oversized, ...metadata })).toThrow(
      /wrapped_key must be between/,
    );
  });

  it("rejects blobs too small to be an authenticated ciphertext", () => {
    expect(() =>
      assertClientWrappedBackup({ wrappedKey: Buffer.alloc(4, 1).toString("base64"), ...metadata }),
    ).toThrow(/does not look like an encrypted wallet backup/);
  });

  it("accepts a backup that fills the storage column", () => {
    const atLimit = Buffer.alloc(384, 1).toString("base64");
    expect(atLimit).toHaveLength(MAX_WRAPPED_KEY_LENGTH);
    expect(() => assertClientWrappedBackup({ wrappedKey: atLimit, ...metadata })).not.toThrow();
  });

  it("requires the client to describe how it encrypted the backup", () => {
    expect(() =>
      assertClientWrappedBackup({ wrappedKey: wrapped(84), algorithm: "", kdf: "scrypt" }),
    ).toThrow(/wrap_algorithm/);
    expect(() =>
      assertClientWrappedBackup({ wrappedKey: wrapped(84), algorithm: "aes-256-gcm", kdf: "" }),
    ).toThrow(/wrap_kdf/);
  });

  it("rejects oversized KDF metadata", () => {
    expect(() =>
      assertClientWrappedBackup({
        wrappedKey: wrapped(84),
        algorithm: "aes-256-gcm",
        kdf: "x".repeat(65),
      }),
    ).toThrow(/wrap_kdf/);
  });
});
