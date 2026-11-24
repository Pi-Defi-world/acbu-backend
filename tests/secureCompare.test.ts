// Tests for the shared constant-time secret comparison helper (W10-BE-006).
import crypto from "crypto";
import { constantTimeEqual, constantTimeEqualAny } from "../src/utils/secureCompare";

describe("constantTimeEqual", () => {
  it("returns true for identical secrets", () => {
    expect(constantTimeEqual("s3cr3t-admin-key", "s3cr3t-admin-key")).toBe(true);
  });

  it("returns true for two empty strings", () => {
    expect(constantTimeEqual("", "")).toBe(true);
  });

  it("returns false for equal-length secrets that differ", () => {
    expect(constantTimeEqual("s3cr3t-admin-key", "s3cr3t-admin-kez")).toBe(false);
  });

  it("returns false without throwing when lengths differ", () => {
    expect(() => constantTimeEqual("short", "a-much-longer-secret")).not.toThrow();
    expect(constantTimeEqual("short", "a-much-longer-secret")).toBe(false);
    expect(constantTimeEqual("a-much-longer-secret", "short")).toBe(false);
  });

  it("does not leak length: every comparison runs on fixed-size 32-byte digests", () => {
    const spy = jest.spyOn(crypto, "timingSafeEqual");

    constantTimeEqual("a", "a-much-longer-candidate-key");

    // One call regardless of the inputs' lengths — there is no early
    // `a.length !== b.length` bail-out that would leak the expected length.
    expect(spy).toHaveBeenCalledTimes(1);
    const [digestA, digestB] = spy.mock.calls[0]!;
    expect(digestA).toHaveLength(32);
    expect(digestB).toHaveLength(32);

    spy.mockRestore();
  });

  it("compares multi-byte unicode secrets by their UTF-8 bytes", () => {
    expect(constantTimeEqual("clé-🔑", "clé-🔑")).toBe(true);
    expect(constantTimeEqual("clé-🔑", "cle-🔑")).toBe(false);
  });
});

describe("constantTimeEqualAny", () => {
  it("returns true when the provided value matches any candidate", () => {
    expect(constantTimeEqualAny("key-b", ["key-a", "key-b", "key-c"])).toBe(true);
  });

  it("returns false when the provided value matches no candidate", () => {
    expect(constantTimeEqualAny("key-z", ["key-a", "key-b", "key-c"])).toBe(false);
  });

  it("returns false for an empty candidate list", () => {
    expect(constantTimeEqualAny("key-a", [])).toBe(false);
  });

  it("compares every candidate even after a match, so timing does not reveal which one matched", () => {
    const spy = jest.spyOn(crypto, "timingSafeEqual");

    expect(constantTimeEqualAny("key-a", ["key-a", "key-b", "key-c"])).toBe(true);
    expect(spy).toHaveBeenCalledTimes(3);

    spy.mockRestore();
  });
});
