import bcrypt from "bcrypt";
import {
  RECOVERY_OTP_LOCKOUT_ERROR,
  RECOVERY_OTP_UNAVAILABLE_ERROR,
  unlockApp,
  verifyRecoveryOtp,
} from "../src/services/recovery";
import { prisma } from "../src/config/database";
import { postUnlockVerify } from "../src/controllers/recoveryController";
import { generateApiKey } from "../src/middleware/auth";
import { signChallengeToken, verifyChallengeToken } from "../src/utils/jwt";
import { getRabbitMQChannel } from "../src/config/rabbitmq";
import { logger } from "../src/config/logger";
import {
  checkRecoveryRateLimit,
  recordRecoveryAttempt,
  RECOVERY_OTP_MAX_ATTEMPTS,
} from "../src/services/recovery/rateLimitService";
import {
  verifyDevice,
  trustDevice,
  isDeviceRateLimited,
} from "../src/services/recovery/deviceVerification";
import {
  auditRecoveryEvent,
  detectSuspiciousPatterns,
  rotateUserSessions,
} from "../src/services/recovery/auditService";

jest.mock("../src/config/database", () => ({
  prisma: {
    user: {
      findFirst: jest.fn(),
    },
    otpChallenge: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    recoveryAttempt: {
      count: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock("../src/middleware/auth", () => ({
  generateApiKey: jest.fn(),
}));

jest.mock("../src/utils/jwt", () => ({
  signChallengeToken: jest.fn(),
  verifyChallengeToken: jest.fn(),
  revokeJti: jest.fn(),
}));

jest.mock("../src/config/rabbitmq", () => ({
  getRabbitMQChannel: jest.fn(),
  QUEUES: {
    OTP_SEND: "otp_send",
  },
}));

jest.mock("../src/config/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../src/services/recovery/rateLimitService", () => ({
  checkRecoveryRateLimit: jest.fn(),
  recordRecoveryAttempt: jest.fn(),
  RECOVERY_OTP_MAX_ATTEMPTS: 5,
  RECOVERY_OTP_ATTEMPT_PREFIX: "recovery-otp",
}));

jest.mock("../src/services/recovery/deviceVerification", () => ({
  verifyDevice: jest.fn(),
  trustDevice: jest.fn(),
  isDeviceRateLimited: jest.fn(),
}));

jest.mock("../src/services/recovery/auditService", () => ({
  auditRecoveryEvent: jest.fn(),
  detectSuspiciousPatterns: jest.fn(),
  rotateUserSessions: jest.fn(),
}));

const mockPrismaUserFindFirst = prisma.user.findFirst as jest.Mock;
const mockPrismaOtpCreate = prisma.otpChallenge.create as jest.Mock;
const mockPrismaOtpFindFirst = prisma.otpChallenge.findFirst as jest.Mock;
const mockPrismaOtpUpdate = prisma.otpChallenge.update as jest.Mock;
const mockGenerateApiKey = generateApiKey as jest.Mock;
const mockSignChallengeToken = signChallengeToken as jest.Mock;
const mockVerifyChallengeToken = verifyChallengeToken as jest.Mock;
const mockGetRabbitMQChannel = getRabbitMQChannel as jest.Mock;
const mockCheckRecoveryRateLimit = checkRecoveryRateLimit as jest.Mock;
const mockRecordRecoveryAttempt = recordRecoveryAttempt as jest.Mock;
const mockVerifyDevice = verifyDevice as jest.Mock;
const mockTrustDevice = trustDevice as jest.Mock;
const mockIsDeviceRateLimited = isDeviceRateLimited as jest.Mock;
const mockAuditRecoveryEvent = auditRecoveryEvent as jest.Mock;
const mockDetectSuspiciousPatterns = detectSuspiciousPatterns as jest.Mock;
const mockRotateUserSessions = rotateUserSessions as jest.Mock;

describe("recoveryService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrismaOtpCreate.mockReset();
    mockSignChallengeToken.mockReset();
    mockVerifyChallengeToken.mockReset();
    mockPrismaOtpFindFirst.mockReset();
    mockPrismaOtpUpdate.mockReset();
    mockGenerateApiKey.mockReset();
    mockCheckRecoveryRateLimit.mockReset();
    mockRecordRecoveryAttempt.mockReset();
    mockAuditRecoveryEvent.mockReset();
    mockGetRabbitMQChannel.mockReturnValue({
      assertQueue: jest.fn().mockResolvedValue(undefined),
      sendToQueue: jest.fn(),
    });
    mockPrismaOtpCreate.mockResolvedValue(undefined);
    mockCheckRecoveryRateLimit.mockResolvedValue({
      allowed: true,
      remainingAttempts: 5,
    });
    mockIsDeviceRateLimited.mockResolvedValue(false);
    mockVerifyDevice.mockResolvedValue({
      deviceId: "device-1",
      isTrusted: false,
      requiresVerification: false,
    });
    mockDetectSuspiciousPatterns.mockResolvedValue({
      isSuspicious: false,
      reasons: [],
    });
    mockRecordRecoveryAttempt.mockResolvedValue(undefined);
    mockAuditRecoveryEvent.mockResolvedValue(undefined);
    mockRotateUserSessions.mockResolvedValue(undefined);
    mockTrustDevice.mockResolvedValue(undefined);
  });

  describe("unlockApp", () => {
    it("returns challenge token after valid identifier + passcode", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        id: "user-1",
        passcodeHash: await bcrypt.hash("1234", 10),
        email: "user@example.com",
        phoneE164: "+12345678901",
      });
      mockSignChallengeToken.mockReturnValue("challenge-token");

      const out = await unlockApp({
        identifier: "user@example.com",
        passcode: "1234",
        deviceFingerprint: { os: "Android", browser: "Chrome" } as any,
      });

      expect(out).toEqual({
        challenge_token: "challenge-token",
        channel: "email",
        requires_device_verification: false,
        device_id: "device-1",
        rate_limit_info: {
          remaining_attempts: 5,
        },
      });
      expect(mockPrismaOtpCreate).toHaveBeenCalledTimes(1);
      expect(mockSignChallengeToken).toHaveBeenCalledWith("user-1");
    });

    it("binds the recovery token to the issued OTP challenge", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        id: "user-1",
        passcodeHash: await bcrypt.hash("1234", 10),
        email: "user@example.com",
        phoneE164: "+12345678901",
      });
      mockPrismaOtpCreate.mockResolvedValue({ id: "otp-42" });
      mockSignChallengeToken.mockReturnValue("challenge-token");

      await unlockApp({
        identifier: "user@example.com",
        passcode: "1234",
        deviceFingerprint: { os: "Android", browser: "Chrome" } as any,
      });

      expect(mockSignChallengeToken).toHaveBeenCalledWith("user-1", {
        otpChallengeId: "otp-42",
      });
    });

    it("rejects invalid passcode", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        id: "user-1",
        passcodeHash: await bcrypt.hash("1234", 10),
        email: "user@example.com",
        phoneE164: "+12345678901",
      });

      await expect(
        unlockApp({
          identifier: "user@example.com",
          passcode: "9999",
          deviceFingerprint: { os: "Android", browser: "Chrome" } as any,
        }),
      ).rejects.toThrow("Invalid passcode");
    });
  });

  describe("verifyRecoveryOtp", () => {
    it("issues API key on valid OTP", async () => {
      mockVerifyChallengeToken.mockReturnValue({
        userId: "user-1",
        otpChallengeId: "otp-1",
      });
      mockPrismaOtpFindFirst.mockResolvedValue({
        id: "otp-1",
        codeHash: await bcrypt.hash("111111", 10),
      });
      mockGenerateApiKey.mockResolvedValue("api-key-1");

      const out = await verifyRecoveryOtp({
        challenge_token: "challenge-token",
        code: "111111",
      });

      expect(out).toEqual({ api_key: "api-key-1", user_id: "user-1" });
      expect(mockPrismaOtpUpdate).toHaveBeenCalledWith({
        where: { id: "otp-1" },
        data: { usedAt: expect.any(Date) },
      });
      expect(mockPrismaOtpFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "otp-1" }),
        }),
      );
      expect(mockGenerateApiKey).toHaveBeenCalledWith("user-1", []);
      expect(mockVerifyChallengeToken).toHaveBeenCalledWith("challenge-token", {
        consumeJti: false,
      });
    });

    it("rejects an invalid challenge before checking OTP limits", async () => {
      mockVerifyChallengeToken.mockImplementation(() => {
        throw new Error("bad token");
      });

      await expect(
        verifyRecoveryOtp({
          challenge_token: "challenge-token",
          code: "111111",
        }),
      ).rejects.toThrow("Invalid or expired challenge");

      expect(mockPrismaOtpFindFirst).not.toHaveBeenCalled();
      expect(mockCheckRecoveryRateLimit).not.toHaveBeenCalled();
    });

    it("rejects an expired challenge before checking OTP limits", async () => {
      mockVerifyChallengeToken.mockReturnValue({ userId: "user-1" });
      mockPrismaOtpFindFirst.mockResolvedValue(null);

      await expect(
        verifyRecoveryOtp({
          challenge_token: "challenge-token",
          code: "111111",
        }),
      ).rejects.toThrow("Invalid or expired code");

      expect(mockCheckRecoveryRateLimit).not.toHaveBeenCalled();
    });

    it("counts a wrong OTP and allows a correct retry", async () => {
      mockVerifyChallengeToken.mockReturnValue({ userId: "user-1" });
      mockPrismaOtpFindFirst.mockResolvedValue({
        id: "otp-1",
        codeHash: await bcrypt.hash("111111", 10),
      });
      mockCheckRecoveryRateLimit
        .mockResolvedValueOnce({ allowed: true, remainingAttempts: 4 })
        .mockResolvedValueOnce({ allowed: true, remainingAttempts: 3 });
      mockGenerateApiKey.mockResolvedValue("api-key-1");

      await expect(
        verifyRecoveryOtp({
          challenge_token: "challenge-token",
          code: "222222",
          deviceFingerprint: { userAgent: "test", ip: "192.0.2.1" },
        }),
      ).rejects.toThrow("Invalid code");

      await expect(
        verifyRecoveryOtp({
          challenge_token: "challenge-token",
          code: "111111",
          deviceFingerprint: { userAgent: "test", ip: "192.0.2.1" },
        }),
      ).resolves.toEqual({ api_key: "api-key-1", user_id: "user-1" });

      expect(mockRecordRecoveryAttempt).toHaveBeenCalledTimes(2);
      expect(mockRecordRecoveryAttempt).toHaveBeenNthCalledWith(
        1,
        "user-1",
        expect.stringMatching(/^recovery-otp:[a-f0-9]{64}$/),
        false,
        "recovery-otp:invalid",
        "192.0.2.1",
        "test",
      );
      expect(mockCheckRecoveryRateLimit).toHaveBeenCalledWith(
        expect.stringMatching(/^recovery-otp:[a-f0-9]{64}$/),
        "user-1",
        "192.0.2.1",
        "recovery-otp",
      );
    });

    it("locks the challenge on the fifth failed attempt", async () => {
      mockVerifyChallengeToken.mockReturnValue({ userId: "user-1" });
      mockPrismaOtpFindFirst
        .mockResolvedValueOnce({
          id: "otp-1",
          codeHash: await bcrypt.hash("111111", 10),
        })
        .mockResolvedValue(null);
      mockCheckRecoveryRateLimit.mockResolvedValue({ allowed: true, remainingAttempts: 1 });

      await expect(
        verifyRecoveryOtp({
          challenge_token: "challenge-token",
          code: "222222",
        }),
      ).rejects.toThrow(RECOVERY_OTP_LOCKOUT_ERROR);

      expect(mockPrismaOtpUpdate).toHaveBeenCalledWith({
        where: { id: "otp-1" },
        data: { usedAt: expect.any(Date) },
      });
      expect(mockAuditRecoveryEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          risk: "high",
          details: expect.objectContaining({
            attemptCount: RECOVERY_OTP_MAX_ATTEMPTS,
            challengeLocked: true,
          }),
        }),
      );

      await expect(
        verifyRecoveryOtp({
          challenge_token: "challenge-token",
          code: "111111",
        }),
      ).rejects.toThrow("Invalid or expired code");
      expect(mockGenerateApiKey).not.toHaveBeenCalled();
    });

    it("allows a correct OTP on the fifth attempt", async () => {
      mockVerifyChallengeToken.mockReturnValue({ userId: "user-1" });
      mockPrismaOtpFindFirst.mockResolvedValue({
        id: "otp-1",
        codeHash: await bcrypt.hash("111111", 10),
      });
      mockCheckRecoveryRateLimit.mockResolvedValue({ allowed: true, remainingAttempts: 1 });
      mockGenerateApiKey.mockResolvedValue("api-key-1");

      await expect(
        verifyRecoveryOtp({
          challenge_token: "challenge-token",
          code: "111111",
        }),
      ).resolves.toEqual({ api_key: "api-key-1", user_id: "user-1" });

      expect(mockPrismaOtpUpdate).toHaveBeenCalledWith({
        where: { id: "otp-1" },
        data: { usedAt: expect.any(Date) },
      });
    });

    it("locks a challenge after repeated brute-force attempts", async () => {
      const challenge = {
        id: "otp-1",
        codeHash: await bcrypt.hash("111111", 10),
      };
      let locked = false;
      let remainingAttempts = RECOVERY_OTP_MAX_ATTEMPTS;

      mockVerifyChallengeToken.mockReturnValue({ userId: "user-1" });
      mockPrismaOtpFindFirst.mockImplementation(async () => (locked ? null : challenge));
      mockPrismaOtpUpdate.mockImplementation(async () => {
        locked = true;
        return challenge;
      });
      mockCheckRecoveryRateLimit.mockImplementation(async () => ({
        allowed: true,
        remainingAttempts: remainingAttempts--,
      }));

      for (let attempt = 0; attempt < RECOVERY_OTP_MAX_ATTEMPTS; attempt++) {
        await expect(
          verifyRecoveryOtp({
            challenge_token: "challenge-token",
            code: "222222",
          }),
        ).rejects.toThrow(
          attempt === RECOVERY_OTP_MAX_ATTEMPTS - 1 ? RECOVERY_OTP_LOCKOUT_ERROR : "Invalid code",
        );
      }

      expect(locked).toBe(true);
      expect(mockRecordRecoveryAttempt).toHaveBeenCalledTimes(RECOVERY_OTP_MAX_ATTEMPTS);
      expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain("222222");
      expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain(
        "challenge-token",
      );

      await expect(
        verifyRecoveryOtp({
          challenge_token: "challenge-token",
          code: "111111",
        }),
      ).rejects.toThrow("Invalid or expired code");
      expect(mockGenerateApiKey).not.toHaveBeenCalled();
    });

    it("counts malformed OTP input without checking it", async () => {
      mockVerifyChallengeToken.mockReturnValue({ userId: "user-1" });
      mockPrismaOtpFindFirst.mockResolvedValue({
        id: "otp-1",
        codeHash: await bcrypt.hash("111111", 10),
      });
      const compareSpy = jest.spyOn(bcrypt, "compare");

      await expect(
        verifyRecoveryOtp({
          challenge_token: "challenge-token",
          code: "12x",
        }),
      ).rejects.toThrow("Invalid code");

      expect(compareSpy).not.toHaveBeenCalled();
      expect(mockRecordRecoveryAttempt).toHaveBeenCalledWith(
        "user-1",
        expect.stringMatching(/^recovery-otp:[a-f0-9]{64}$/),
        false,
        "recovery-otp:invalid",
        "unknown",
        undefined,
      );
      compareSpy.mockRestore();
    });

    it("returns a generic lockout when the broader limiter denies the attempt", async () => {
      mockVerifyChallengeToken.mockReturnValue({ userId: "user-1" });
      mockPrismaOtpFindFirst.mockResolvedValue({
        id: "otp-1",
        codeHash: await bcrypt.hash("111111", 10),
      });
      mockCheckRecoveryRateLimit.mockResolvedValue({
        allowed: false,
        remainingAttempts: 0,
        reason: "Too many attempts from this IP address. Please try again later.",
      });

      await expect(
        verifyRecoveryOtp({
          challenge_token: "challenge-token",
          code: "111111",
        }),
      ).rejects.toThrow(RECOVERY_OTP_LOCKOUT_ERROR);

      expect(mockRecordRecoveryAttempt).not.toHaveBeenCalled();
      expect(mockPrismaOtpUpdate).toHaveBeenCalledWith({
        where: { id: "otp-1" },
        data: { usedAt: expect.any(Date) },
      });
    });

    it("fails closed when the rate-limit store is unavailable", async () => {
      mockVerifyChallengeToken.mockReturnValue({ userId: "user-1" });
      mockPrismaOtpFindFirst.mockResolvedValue({
        id: "otp-1",
        codeHash: await bcrypt.hash("111111", 10),
      });
      mockCheckRecoveryRateLimit.mockRejectedValue(new Error("database unavailable"));

      await expect(
        verifyRecoveryOtp({
          challenge_token: "challenge-token",
          code: "111111",
        }),
      ).rejects.toThrow(RECOVERY_OTP_UNAVAILABLE_ERROR);

      expect(mockRecordRecoveryAttempt).not.toHaveBeenCalled();
      expect(mockPrismaOtpUpdate).not.toHaveBeenCalled();
      expect(mockGenerateApiKey).not.toHaveBeenCalled();
    });

    it("fails closed when recording an OTP attempt fails", async () => {
      mockVerifyChallengeToken.mockReturnValue({ userId: "user-1" });
      mockPrismaOtpFindFirst.mockResolvedValue({
        id: "otp-1",
        codeHash: await bcrypt.hash("111111", 10),
      });
      mockRecordRecoveryAttempt.mockRejectedValue(new Error("database unavailable"));

      await expect(
        verifyRecoveryOtp({
          challenge_token: "challenge-token",
          code: "111111",
        }),
      ).rejects.toThrow(RECOVERY_OTP_UNAVAILABLE_ERROR);

      expect(mockPrismaOtpUpdate).not.toHaveBeenCalled();
      expect(mockGenerateApiKey).not.toHaveBeenCalled();
    });

    it("rejects invalid OTP", async () => {
      mockVerifyChallengeToken.mockReturnValue({ userId: "user-1" });
      mockPrismaOtpFindFirst.mockResolvedValue({
        id: "otp-1",
        codeHash: await bcrypt.hash("111111", 10),
      });

      await expect(
        verifyRecoveryOtp({
          challenge_token: "challenge-token",
          code: "222222",
        }),
      ).rejects.toThrow("Invalid code");
    });
  });
});

describe("recoveryController", () => {
  it("returns a generic error for a missing challenge token", async () => {
    const next = jest.fn();

    await postUnlockVerify({ body: {}, headers: {} } as any, {} as any, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Invalid or expired challenge",
        statusCode: 401,
      }),
    );
  });
});
