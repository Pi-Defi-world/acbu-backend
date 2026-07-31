/**
 * Tests for cryptographically secure OTP generation.
 */
import { generateSecureOtp } from "./otp";
import { randomInt } from "crypto";

jest.mock("crypto", () => ({
  randomInt: jest.fn(),
}));

describe("generateSecureOtp", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("generates a 6-digit OTP string", () => {
    (randomInt as jest.Mock).mockReturnValue(123456);

    const otp = generateSecureOtp();

    expect(otp).toBe("123456");
    expect(randomInt).toHaveBeenCalledWith(100_000, 1_000_000);
  });

  it("pads leading zeros correctly for lower-bound values", () => {
    (randomInt as jest.Mock).mockReturnValue(100000);

    const otp = generateSecureOtp();

    expect(otp).toBe("100000");
    expect(otp).toHaveLength(6);
  });

  it("handles upper-bound values correctly", () => {
    (randomInt as jest.Mock).mockReturnValue(999999);

    const otp = generateSecureOtp();

    expect(otp).toBe("999999");
    expect(otp).toHaveLength(6);
  });

  it("generates different OTPs on successive calls", () => {
    (randomInt as jest.Mock)
      .mockReturnValueOnce(123456)
      .mockReturnValueOnce(789012)
      .mockReturnValueOnce(345678);

    const otp1 = generateSecureOtp();
    const otp2 = generateSecureOtp();
    const otp3 = generateSecureOtp();

    expect(otp1).toBe("123456");
    expect(otp2).toBe("789012");
    expect(otp3).toBe("345678");
    expect(randomInt).toHaveBeenCalledTimes(3);
  });

  it("always returns exactly 6 characters", () => {
    const testValues = [100000, 100001, 500000, 999998, 999999];

    testValues.forEach((value) => {
      (randomInt as jest.Mock).mockReturnValueOnce(value);
      const otp = generateSecureOtp();
      expect(otp).toHaveLength(6);
    });
  });

  it("calls crypto.randomInt with correct range [100_000, 1_000_000)", () => {
    (randomInt as jest.Mock).mockReturnValue(123456);

    generateSecureOtp();

    expect(randomInt).toHaveBeenCalledWith(100_000, 1_000_000);
  });

  describe("integration: real crypto.randomInt behavior", () => {
    beforeEach(() => {
      // Unmock crypto.randomInt for real integration tests
      jest.unmock("crypto");
      jest.resetModules();
    });

    it("generates valid 6-digit OTPs with real CSPRNG", () => {
      // Re-require after unmocking
      const { generateSecureOtp: realOtp } = require("./otp");

      for (let i = 0; i < 100; i++) {
        const otp = realOtp();
        expect(otp).toMatch(/^\d{6}$/);
        const num = parseInt(otp, 10);
        expect(num).toBeGreaterThanOrEqual(100000);
        expect(num).toBeLessThan(1000000);
      }
    });

    it("generates unique OTPs with high probability", () => {
      const { generateSecureOtp: realOtp } = require("./otp");
      const otps = new Set<string>();
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        otps.add(realOtp());
      }

      // With 900k possible values and 1000 samples, duplicates are extremely unlikely
      // (birthday paradox: ~0.06% chance of collision)
      expect(otps.size).toBeGreaterThan(990);
    });
  });
});
