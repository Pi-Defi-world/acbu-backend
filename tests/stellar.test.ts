import { isValidStellarAddress, assertValidStellarAddress } from "../src/utils/stellar";
import { Keypair } from "stellar-sdk";

describe("Stellar address validation", () => {
  const validAddress = Keypair.random().publicKey();

  test("accepts a valid G-address from Keypair.random()", () => {
    expect(isValidStellarAddress(validAddress)).toBe(true);
  });

  test("rejects address starting with P (the old placeholder bug)", () => {
    const badAddress = "P" + "A".repeat(55);
    expect(isValidStellarAddress(badAddress)).toBe(false);
  });

  test("rejects empty string", () => {
    expect(isValidStellarAddress("")).toBe(false);
  });

  test("rejects null/undefined", () => {
    expect(isValidStellarAddress(null as unknown as string)).toBe(false);
    expect(isValidStellarAddress(undefined as unknown as string)).toBe(false);
  });

  test("rejects address with wrong length", () => {
    expect(isValidStellarAddress("GABC")).toBe(false);
    expect(isValidStellarAddress("G" + "A".repeat(56))).toBe(false);
  });

  test("rejects 56-char string not starting with G", () => {
    const badPrefix = "S" + validAddress.slice(1);
    expect(isValidStellarAddress(badPrefix)).toBe(false);
  });

  test("rejects G-address with invalid base32 checksum", () => {
    // Flip last char to break checksum
    const corrupted = validAddress.slice(0, -1) + (validAddress.endsWith("A") ? "B" : "A");
    expect(isValidStellarAddress(corrupted)).toBe(false);
  });

  test("assertValidStellarAddress does not throw for valid address", () => {
    expect(() => assertValidStellarAddress(validAddress)).not.toThrow();
  });

  test("assertValidStellarAddress throws for invalid address", () => {
    expect(() => assertValidStellarAddress("P" + "A".repeat(55))).toThrow(
      /Invalid Stellar address format/,
    );
  });

  test("multiple random keypairs all produce valid addresses", () => {
    for (let i = 0; i < 10; i++) {
      const kp = Keypair.random();
      expect(isValidStellarAddress(kp.publicKey())).toBe(true);
      expect(kp.publicKey()).toMatch(/^G/);
      expect(kp.publicKey()).toHaveLength(56);
    }
  });
});
