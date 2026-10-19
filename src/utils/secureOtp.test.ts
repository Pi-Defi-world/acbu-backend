import { randomInt } from "node:crypto";
import { generateSecureOtp } from "./secureOtp";

jest.mock("node:crypto", () => ({
  randomInt: jest.fn(),
}));

const mockedRandomInt = jest.mocked(randomInt);

describe("generateSecureOtp", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([100000, 999999])("returns the six-digit boundary value %s", (value) => {
    mockedRandomInt.mockReturnValue(value);

    const otp = generateSecureOtp();

    expect(typeof otp).toBe("string");
    expect(otp).toHaveLength(6);
    expect(otp).toMatch(/^\d{6}$/);
    expect(Number(otp)).toBeGreaterThanOrEqual(100000);
    expect(Number(otp)).toBeLessThan(1000000);
    expect(randomInt).toHaveBeenCalledWith(100000, 1000000);
  });
});