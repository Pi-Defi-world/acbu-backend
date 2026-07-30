import bcrypt from "bcrypt";
import { unlockApp, verifyRecoveryOtp } from "../src/services/recovery";
import { prisma } from "../src/config/database";
import { generateApiKey } from "../src/middleware/auth";
import { signChallengeToken, verifyChallengeToken } from "../src/utils/jwt";
import { getRabbitMQChannel } from "../src/config/rabbitmq";
import {
  checkRecoveryRateLimit,
  recordRecoveryAttempt,
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
    mockGetRabbitMQChannel.mockReturnValue({
      assertQueue: jest.fn().mockResolvedValue(undefined),
      sendToQueue: jest.fn(),
    });
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

    it("rejects invalid passcode", async () => {
      mockPrismaUserFindFirst.mockResolvedValue({
        id: "user-1",
        passcodeHash: await bcrypt.hash("1234", 10),
        email: "user@example.com",
        phoneE164: "+12345678901",
      });

      await expect(
        unlockApp({ identifier: "user@example.com", passcode: "9999", deviceFingerprint: { os: "Android", browser: "Chrome" } as any }),
      ).rejects.toThrow("Invalid passcode");
    });
  });

  describe("verifyRecoveryOtp", () => {
    it("issues API key on valid OTP", async () => {
      mockVerifyChallengeToken.mockReturnValue({ userId: "user-1" });
      mockPrismaOtpFindFirst.mockResolvedValue({
        id: "otp-1",
        codeHash: await bcrypt.hash("111111", 10),
        failedAttempts: 0,
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
      expect(mockGenerateApiKey).toHaveBeenCalledWith("user-1", []);
    });

    it("rejects invalid OTP and increments failed attempts", async () => {
      mockVerifyChallengeToken.mockReturnValue({ userId: "user-1" });
      mockPrismaOtpFindFirst.mockResolvedValue({
        id: "otp-1",
        codeHash: await bcrypt.hash("111111", 10),
        failedAttempts: 0,
      });

      await expect(
        verifyRecoveryOtp({
          challenge_token: "challenge-token",
          code: "222222",
        }),
      ).rejects.toThrow("Invalid code");

      // Must increment failedAttempts (no lock yet — only 1 attempt)
      expect(mockPrismaOtpUpdate).toHaveBeenCalledWith({
        where: { id: "otp-1" },
        data: { failedAttempts: 1 },
      });
    });

    it("does not set lockedAt before the threshold is reached", async () => {
      mockVerifyChallengeToken.mockReturnValue({ userId: "user-1" });
      mockPrismaOtpFindFirst.mockResolvedValue({
        id: "otp-1",
        codeHash: await bcrypt.hash("111111", 10),
        // 3 prior failures — still one short of the limit
        failedAttempts: 3,
      });

      await expect(
        verifyRecoveryOtp({
          challenge_token: "challenge-token",
          code: "000000",
        }),
      ).rejects.toThrow("Invalid code");

      // failedAttempts becomes 4 — no lockedAt
      expect(mockPrismaOtpUpdate).toHaveBeenCalledWith({
        where: { id: "otp-1" },
        data: { failedAttempts: 4 },
      });
    });

    it("locks the challenge on the 5th failed attempt", async () => {
      mockVerifyChallengeToken.mockReturnValue({ userId: "user-1" });
      mockPrismaOtpFindFirst.mockResolvedValue({
        id: "otp-1",
        codeHash: await bcrypt.hash("111111", 10),
        // 4 prior failures — next one hits the cap
        failedAttempts: 4,
      });

      await expect(
        verifyRecoveryOtp({
          challenge_token: "challenge-token",
          code: "000000",
        }),
      ).rejects.toThrow("Invalid code");

      // failedAttempts becomes 5 AND lockedAt must be set
      expect(mockPrismaOtpUpdate).toHaveBeenCalledWith({
        where: { id: "otp-1" },
        data: { failedAttempts: 5, lockedAt: expect.any(Date) },
      });
    });

    it("rejects immediately when challenge is already locked (not returned by query)", async () => {
      mockVerifyChallengeToken.mockReturnValue({ userId: "user-1" });
      // The findFirst query excludes lockedAt != null rows, so it returns null
      mockPrismaOtpFindFirst.mockResolvedValue(null);

      await expect(
        verifyRecoveryOtp({
          challenge_token: "challenge-token",
          code: "111111",
        }),
      ).rejects.toThrow("Invalid or expired code");

      // No attempt-counter update should occur
      expect(mockPrismaOtpUpdate).not.toHaveBeenCalled();
    });

    it("emits a high-risk audit event when the challenge is locked", async () => {
      mockVerifyChallengeToken.mockReturnValue({ userId: "user-1" });
      mockPrismaOtpFindFirst.mockResolvedValue({
        id: "otp-1",
        codeHash: await bcrypt.hash("111111", 10),
        failedAttempts: 4,
      });

      await expect(
        verifyRecoveryOtp({
          challenge_token: "challenge-token",
          code: "000000",
        }),
      ).rejects.toThrow("Invalid code");

      expect(mockAuditRecoveryEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "recovery_failed",
          userId: "user-1",
          risk: "high",
          details: expect.objectContaining({
            challengeLocked: true,
            failedAttempts: 5,
          }),
        }),
      );
    });

    it("emits a medium-risk audit event for a non-locking wrong guess", async () => {
      mockVerifyChallengeToken.mockReturnValue({ userId: "user-1" });
      mockPrismaOtpFindFirst.mockResolvedValue({
        id: "otp-1",
        codeHash: await bcrypt.hash("111111", 10),
        failedAttempts: 1,
      });

      await expect(
        verifyRecoveryOtp({
          challenge_token: "challenge-token",
          code: "000000",
        }),
      ).rejects.toThrow("Invalid code");

      expect(mockAuditRecoveryEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          risk: "medium",
          details: expect.objectContaining({ challengeLocked: false }),
        }),
      );
    });
  });
});
