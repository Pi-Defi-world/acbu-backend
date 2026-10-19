import bcrypt from "bcrypt";
import { prisma } from "../../config/database";
import { getRabbitMQChannel } from "../../config/rabbitmq";
import { generateSecureOtp } from "../../utils/secureOtp";
import { checkRecoveryRateLimit, recordRecoveryAttempt } from "./rateLimitService";
import { detectSuspiciousPatterns, auditRecoveryEvent } from "./auditService";
import { isDeviceRateLimited, verifyDevice } from "./deviceVerification";
import { signChallengeToken } from "../../utils/jwt";
import { unlockApp } from "./recoveryService";

jest.mock("bcrypt", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

jest.mock("../../config/database", () => ({
  prisma: {
    user: { findFirst: jest.fn() },
    otpChallenge: { create: jest.fn() },
  },
}));

jest.mock("../../config/logger", () => ({
  logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

jest.mock("../../config/rabbitmq", () => ({
  getRabbitMQChannel: jest.fn(),
  QUEUES: { OTP_SEND: "otp_send" },
}));

jest.mock("../../utils/jwt", () => ({
  signChallengeToken: jest.fn(),
  verifyChallengeToken: jest.fn(),
  revokeJti: jest.fn(),
}));

jest.mock("../../utils/secureOtp", () => ({
  generateSecureOtp: jest.fn().mockReturnValue("654321"),
}));

jest.mock("./deviceVerification", () => ({
  verifyDevice: jest.fn(),
  trustDevice: jest.fn(),
  isDeviceRateLimited: jest.fn(),
}));

jest.mock("./rateLimitService", () => ({
  checkRecoveryRateLimit: jest.fn(),
  recordRecoveryAttempt: jest.fn(),
  RECOVERY_OTP_ATTEMPT_PREFIX: "recovery-otp",
  RECOVERY_OTP_MAX_ATTEMPTS: 5,
}));

jest.mock("./auditService", () => ({
  auditRecoveryEvent: jest.fn(),
  detectSuspiciousPatterns: jest.fn(),
  rotateUserSessions: jest.fn(),
}));

describe("recoveryService OTP generation", () => {
  const mqChannel = {
    assertQueue: jest.fn().mockResolvedValue(undefined),
    sendToQueue: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue("hashed-otp");
    (prisma.user.findFirst as jest.Mock).mockResolvedValue({
      id: "user-1",
      passcodeHash: "hashed-passcode",
      email: "person@example.com",
      phoneE164: null,
    });
    (prisma.otpChallenge.create as jest.Mock).mockResolvedValue({ id: "challenge-1" });
    (getRabbitMQChannel as jest.Mock).mockReturnValue(mqChannel);
    (signChallengeToken as jest.Mock).mockReturnValue("recovery-challenge-token");
    (checkRecoveryRateLimit as jest.Mock).mockResolvedValue({
      allowed: true,
      remainingAttempts: 4,
    });
    (isDeviceRateLimited as jest.Mock).mockResolvedValue(false);
    (verifyDevice as jest.Mock).mockResolvedValue({
      deviceId: "device-1",
      isTrusted: false,
      requiresVerification: true,
    });
    (detectSuspiciousPatterns as jest.Mock).mockResolvedValue({
      isSuspicious: false,
      reasons: [],
    });
  });

  it("uses the shared secure OTP for hashing and delivery", async () => {
    await unlockApp({
      identifier: "person@example.com",
      passcode: "correct-passcode",
      deviceFingerprint: { ip: "127.0.0.1", userAgent: "test-agent" },
    });

    expect(generateSecureOtp).toHaveBeenCalledTimes(1);
    expect(bcrypt.hash).toHaveBeenCalledWith("654321", 10);
    const queuedPayload = JSON.parse(mqChannel.sendToQueue.mock.calls[0][1].toString());
    expect(queuedPayload).toMatchObject({
      channel: "email",
      to: "person@example.com",
      code: "654321",
    });
  });
});