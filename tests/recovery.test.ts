import { unlockApp, verifyRecoveryOtp } from "../src/services/recovery";
import { prisma } from "../src/config/database";
import bcrypt from "bcryptjs";
import { verifyChallengeToken } from "../src/utils/jwt";

jest.mock("../src/config/rabbitmq", () => ({
  getRabbitMQChannel: jest.fn().mockReturnValue({
    assertQueue: jest.fn().mockResolvedValue(undefined),
    sendToQueue: jest.fn(),
  }),
  QUEUES: {
    OTP_SEND: "otp_send",
  },
}));

describe("Recovery Service", () => {
  const testEmail = "test@example.com";
  const testPhone = "+1234567890";
  const testPasscode = "test1234";
  let testUserId: string;

  beforeEach(async () => {
    const passcodeHash = await bcrypt.hash(testPasscode, 10);
    const user = await prisma.user.create({
      data: {
        username: `testuser_${Date.now()}`,
        email: testEmail,
        phoneE164: testPhone,
        passcodeHash,
      },
    });
    testUserId = user.id;
  });

  afterEach(async () => {
    await prisma.otpChallenge.deleteMany({ where: { userId: testUserId } });
    await prisma.user.delete({ where: { id: testUserId } });
  });

  describe("unlockApp", () => {
    it("should reject invalid passcode", async () => {
      await expect(
        unlockApp({
          identifier: testEmail,
          passcode: "wrongpasscode",
        }),
      ).rejects.toThrow("Invalid passcode");
    });

    it("should reject non-existent user", async () => {
      await expect(
        unlockApp({
          identifier: "nonexistent@example.com",
          passcode: testPasscode,
        }),
      ).rejects.toThrow("User not found or recovery not enabled");
    });

    it("should return challenge token for valid credentials (email)", async () => {
      const result = await unlockApp({
        identifier: testEmail,
        passcode: testPasscode,
      });

      expect(result.challenge_token).toBeDefined();
      expect(result.channel).toBe("email");

      const payload = verifyChallengeToken(result.challenge_token);
      expect(payload.userId).toBe(testUserId);
    });

    it("should return challenge token for valid credentials (phone)", async () => {
      const result = await unlockApp({
        identifier: testPhone,
        passcode: testPasscode,
      });

      expect(result.challenge_token).toBeDefined();
      expect(result.channel).toBe("sms");

      const payload = verifyChallengeToken(result.challenge_token);
      expect(payload.userId).toBe(testUserId);
    });

    it("should create OTP challenge record", async () => {
      await unlockApp({
        identifier: testEmail,
        passcode: testPasscode,
      });

      const challenge = await prisma.otpChallenge.findFirst({
        where: { userId: testUserId },
        orderBy: { createdAt: "desc" },
      });

      expect(challenge).not.toBeNull();
      expect(challenge?.channel).toBe("email");
      expect(challenge?.usedAt).toBeNull();
      expect(challenge?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("verifyRecoveryOtp", () => {
    let challengeToken: string;
    let otpCode: string;

    beforeEach(async () => {
      otpCode = "123456";
      const codeHash = await bcrypt.hash(otpCode, 10);

      await prisma.otpChallenge.create({
        data: {
          userId: testUserId,
          codeHash,
          channel: "email",
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      const result = await unlockApp({
        identifier: testEmail,
        passcode: testPasscode,
      });
      challengeToken = result.challenge_token;
    });

    it("should reject invalid OTP code", async () => {
      await expect(
        verifyRecoveryOtp({
          challenge_token: challengeToken,
          code: "999999",
        }),
      ).rejects.toThrow("Invalid code");
    });

    it("should reject expired challenge token", async () => {
      const expiredToken =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0IiwicHVycG9zZSI6InNpZ25pbl8yZmEiLCJpYXQiOjE2MDk0NTkyMDAsImV4cCI6MTYwOTQ1OTIwMH0.test";

      await expect(
        verifyRecoveryOtp({
          challenge_token: expiredToken,
          code: otpCode,
        }),
      ).rejects.toThrow();
    });

    it("should issue API key for valid OTP code", async () => {
      const latestChallenge = await prisma.otpChallenge.findFirst({
        where: { userId: testUserId },
        orderBy: { createdAt: "desc" },
      });

      const result = await verifyRecoveryOtp({
        challenge_token: challengeToken,
        code: otpCode,
      });

      expect(result.api_key).toBeDefined();
      expect(result.user_id).toBe(testUserId);

      const updatedChallenge = await prisma.otpChallenge.findUnique({
        where: { id: latestChallenge!.id },
      });
      expect(updatedChallenge?.usedAt).not.toBeNull();
    });

    it("should reject reused OTP code", async () => {
      await verifyRecoveryOtp({
        challenge_token: challengeToken,
        code: otpCode,
      });

      const newResult = await unlockApp({
        identifier: testEmail,
        passcode: testPasscode,
      });

      await expect(
        verifyRecoveryOtp({
          challenge_token: newResult.challenge_token,
          code: otpCode,
        }),
      ).rejects.toThrow("Invalid or expired code");
    });
  });
});
