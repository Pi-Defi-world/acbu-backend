/**
 * Recovery Tier 1: unlock app via email/phone + passcode + OTP + device verification.
 * Enhanced security flow: 1) verify passcode, check rate limits, verify device, send OTP; 2) verify OTP, issue API key, rotate sessions.
 */
import bcrypt from "bcryptjs";
import { Buffer } from "buffer";
import { prisma } from "../../config/database";
import { generateApiKey } from "../../middleware/auth";
import { logger } from "../../config/logger";
import { signChallengeToken, verifyChallengeToken } from "../../utils/jwt";
import { getRabbitMQChannel, QUEUES } from "../../config/rabbitmq";
import {
  verifyDevice,
  trustDevice,
  DeviceFingerprint,
  isDeviceRateLimited,
} from "./deviceVerification";
import {
  checkRecoveryRateLimit,
  recordRecoveryAttempt,
} from "./rateLimitService";
import {
  auditRecoveryEvent,
  detectSuspiciousPatterns,
  rotateUserSessions,
} from "./auditService";

const OTP_EXPIRY_MINUTES = 10;

export interface UnlockAppParams {
  identifier: string; // email or E.164 phone
  passcode: string;
  deviceFingerprint: DeviceFingerprint;
}

export interface UnlockAppResult {
  challenge_token: string;
  channel: "email" | "sms";
  requires_device_verification: boolean;
  device_id?: string;
  rate_limit_info?: {
    remaining_attempts: number;
    reset_time?: Date;
  };
}

export interface VerifyRecoveryOtpParams {
  challenge_token: string;
  code: string;
  deviceFingerprint?: DeviceFingerprint;
  trust_device?: boolean;
}

export interface VerifyRecoveryOtpResult {
  api_key: string;
  user_id: string;
}

function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function publishOtpToQueue(payload: {
  channel: string;
  to: string;
  code: string;
}): Promise<void> {
  try {
    const ch = getRabbitMQChannel();
    await ch.assertQueue(QUEUES.OTP_SEND, { durable: true });
    ch.sendToQueue(QUEUES.OTP_SEND, Buffer.from(JSON.stringify(payload)), {
      persistent: true,
    });
    logger.debug("Recovery OTP published to queue", {
      channel: payload.channel,
    });
  } catch (e) {
    logger.error("Failed to publish recovery OTP to RabbitMQ", e);
    throw new Error("OTP delivery unavailable");
  }
}

/**
 * Step 1: Enhanced security verification with rate limiting, device verification, and audit logging.
 */
export async function unlockApp(
  params: UnlockAppParams,
): Promise<UnlockAppResult> {
  const { identifier, passcode, deviceFingerprint } = params;
  const trimmed = identifier.trim().toLowerCase();
  const isEmail = trimmed.includes("@") && trimmed.includes(".");
  const isPhone = /^\+[0-9]{10,15}$/.test(identifier.trim());

  const where = isEmail
    ? { email: trimmed }
    : isPhone
      ? { phoneE164: identifier.trim() }
      : null;
  if (!where) {
    throw new Error("identifier must be email or E.164 phone");
  }

  // Find user
  const user = await prisma.user.findFirst({
    where,
    select: {
      id: true,
      passcodeHash: true,
      email: true,
      phoneE164: true,
    },
  });
  if (!user || !user.passcodeHash) {
    logger.warn("Recovery: user not found or no passcode set", {
      identifier: isEmail ? "***" : identifier.slice(0, 6) + "***",
    });
    throw new Error("User not found or recovery not enabled");
  }

  // Check rate limits BEFORE any verification
  const rateLimitResult = await checkRecoveryRateLimit(
    identifier,
    user.id,
    deviceFingerprint.ip,
  );

  if (!rateLimitResult.allowed) {
    await recordRecoveryAttempt(
      user.id,
      identifier,
      false,
      rateLimitResult.reason,
      deviceFingerprint.ip,
      deviceFingerprint.userAgent,
    );

    throw new Error(rateLimitResult.reason || "Rate limit exceeded");
  }

  // Check device rate limiting
  const deviceRateLimited = await isDeviceRateLimited(
    user.id,
    deviceFingerprint,
  );
  if (deviceRateLimited) {
    await recordRecoveryAttempt(
      user.id,
      identifier,
      false,
      "Device rate limited",
      deviceFingerprint.ip,
      deviceFingerprint.userAgent,
    );

    throw new Error(
      "Too many attempts from this device. Please try again later.",
    );
  }

  // Verify passcode
  const match = await bcrypt.compare(passcode, user.passcodeHash);
  if (!match) {
    await recordRecoveryAttempt(
      user.id,
      identifier,
      false,
      "Invalid passcode",
      deviceFingerprint.ip,
      deviceFingerprint.userAgent,
    );

    logger.warn("Recovery: invalid passcode", { userId: user.id });
    throw new Error("Invalid passcode");
  }

  // Device verification
  const deviceResult = await verifyDevice(user.id, deviceFingerprint);

  // Check for suspicious patterns
  const suspiciousPatterns = await detectSuspiciousPatterns(user.id);
  const riskLevel = suspiciousPatterns.isSuspicious ? "high" : "medium";

  // Record successful passcode verification
  await recordRecoveryAttempt(
    user.id,
    identifier,
    true,
    "Passcode verified, OTP sent",
    deviceFingerprint.ip,
    deviceFingerprint.userAgent,
  );

  // Generate and send OTP
  const channel = isEmail ? "email" : "sms";
  const to = isEmail ? user.email : user.phoneE164;
  if (!to) {
    throw new Error("Recovery channel not configured");
  }

  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  await prisma.otpChallenge.create({
    data: {
      userId: user.id,
      codeHash,
      channel,
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
    },
  });

  await publishOtpToQueue({ channel, to, code });

  const challenge_token = signChallengeToken(user.id);

  // Audit the recovery initiation
  await auditRecoveryEvent({
    eventType: "recovery_initiated",
    userId: user.id,
    identifier,
    ip: deviceFingerprint.ip,
    userAgent: deviceFingerprint.userAgent,
    deviceId: deviceResult.deviceId,
    details: {
      channel,
      deviceTrusted: deviceResult.isTrusted,
      suspiciousPatterns: suspiciousPatterns.reasons,
    },
    risk: riskLevel,
  });

  logger.info("Recovery: passcode verified, OTP sent", {
    userId: user.id,
    channel,
    deviceTrusted: deviceResult.isTrusted,
    riskLevel,
  });

  return {
    challenge_token,
    channel,
    requires_device_verification: deviceResult.requiresVerification,
    device_id: deviceResult.deviceId,
    rate_limit_info: {
      remaining_attempts: rateLimitResult.remainingAttempts,
    },
  };
}

/**
 * Step 2: Enhanced OTP verification with session rotation and device trust.
 */
export async function verifyRecoveryOtp(
  params: VerifyRecoveryOtpParams,
): Promise<VerifyRecoveryOtpResult> {
  const { challenge_token, code, deviceFingerprint, trust_device } = params;
  const payload = verifyChallengeToken(challenge_token);

  const now = new Date();
  const challenge = await prisma.otpChallenge.findFirst({
    where: {
      userId: payload.userId,
      expiresAt: { gt: now },
      usedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!challenge) {
    await auditRecoveryEvent({
      eventType: "recovery_failed",
      userId: payload.userId,
      ip: deviceFingerprint?.ip,
      userAgent: deviceFingerprint?.userAgent,
      details: { reason: "Invalid or expired OTP" },
      risk: "medium",
    });

    throw new Error("Invalid or expired code");
  }

  const match = await bcrypt.compare(code, challenge.codeHash);
  if (!match) {
    await auditRecoveryEvent({
      eventType: "recovery_failed",
      userId: payload.userId,
      ip: deviceFingerprint?.ip,
      userAgent: deviceFingerprint?.userAgent,
      details: { reason: "Invalid OTP" },
      risk: "medium",
    });

    logger.warn("Recovery: invalid OTP", { userId: payload.userId });
    throw new Error("Invalid code");
  }

  // Mark OTP as used
  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: { usedAt: now },
  });

  // Rotate existing sessions (revoke old API keys)
  await rotateUserSessions(payload.userId);

  // Generate new API key
  const apiKey = await generateApiKey(payload.userId, []);

  // Trust device if requested
  if (trust_device && deviceFingerprint) {
    const deviceResult = await verifyDevice(payload.userId, deviceFingerprint);
    if (!deviceResult.isTrusted) {
      await trustDevice(deviceResult.deviceId);

      await auditRecoveryEvent({
        eventType: "device_trusted",
        userId: payload.userId,
        ip: deviceFingerprint.ip,
        userAgent: deviceFingerprint.userAgent,
        deviceId: deviceResult.deviceId,
        details: { deviceTrusted: true },
        risk: "low",
      });
    }
  }

  // Audit successful recovery
  await auditRecoveryEvent({
    eventType: "recovery_completed",
    userId: payload.userId,
    ip: deviceFingerprint?.ip,
    userAgent: deviceFingerprint?.userAgent,
    details: {
      apiKeyGenerated: true,
      sessionsRotated: true,
      deviceTrusted: trust_device,
    },
    risk: "medium",
  });

  logger.info("Recovery: OTP verified, new key issued, sessions rotated", {
    userId: payload.userId,
    sessionsRotated: true,
  });

  return {
    api_key: apiKey,
    user_id: payload.userId,
  };
}
