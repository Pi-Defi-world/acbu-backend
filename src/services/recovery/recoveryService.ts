/**
 * Recovery Tier 1: unlock app via email/phone + passcode + OTP + device verification.
 * Enhanced security flow: 1) verify passcode, check rate limits, verify device, send OTP; 2) verify OTP, issue API key, rotate sessions.
 */
import bcrypt from "bcrypt";
import { Buffer } from "buffer";
import { createHash } from "crypto";
import { prisma } from "../../config/database";
import { generateApiKey } from "../../middleware/auth";
import { logger } from "../../config/logger";
import { signChallengeToken, verifyChallengeToken, revokeJti } from "../../utils/jwt";
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
  RECOVERY_OTP_ATTEMPT_PREFIX,
  RECOVERY_OTP_MAX_ATTEMPTS,
  type RecoveryRateLimitResult,
} from "./rateLimitService";
import { auditRecoveryEvent, detectSuspiciousPatterns, rotateUserSessions } from "./auditService";

const OTP_EXPIRY_MINUTES = 10;
export const RECOVERY_OTP_LOCKOUT_ERROR = "Too many attempts. Please request a new recovery code.";
export const RECOVERY_OTP_UNAVAILABLE_ERROR = "Recovery verification temporarily unavailable.";

function getRecoveryOtpAttemptKey(challengeToken: string): string {
  return `${RECOVERY_OTP_ATTEMPT_PREFIX}:${createHash("sha256")
    .update(challengeToken)
    .digest("hex")}`;
}

async function revokeRecoveryChallengeToken(payload: ChallengePayload): Promise<void> {
  if (payload.jti && typeof revokeJti === "function") {
    await revokeJti(payload.jti, payload.exp ?? Math.floor(Date.now() / 1000) + 300);
  }
}

function getRecoveryChallengeAttemptCount(remainingAttempts = RECOVERY_OTP_MAX_ATTEMPTS): number {
  return Math.max(1, RECOVERY_OTP_MAX_ATTEMPTS - remainingAttempts + 1);
}

async function recordRecoveryOtpAttempt(
  payload: ChallengePayload,
  attemptKey: string,
  success: boolean,
  reason: string,
  deviceFingerprint?: DeviceFingerprint,
): Promise<void> {
  try {
    await recordRecoveryAttempt(
      payload.userId,
      attemptKey,
      success,
      reason,
      deviceFingerprint?.ip || "unknown",
      deviceFingerprint?.userAgent,
    );
  } catch {
    logger.error("Recovery: OTP attempt tracking unavailable", {
      userId: payload.userId,
      hasIp: Boolean(deviceFingerprint?.ip),
    });
    await revokeRecoveryChallengeToken(payload);
    throw new Error(RECOVERY_OTP_UNAVAILABLE_ERROR);
  }
}

async function markRecoveryChallengeUsed(
  payload: ChallengePayload,
  challengeId: string,
  now: Date,
): Promise<void> {
  try {
    await prisma.otpChallenge.update({
      where: { id: challengeId },
      data: { usedAt: now },
    });
  } catch {
    logger.error("Recovery: failed to update OTP challenge state", {
      userId: payload.userId,
    });
    await revokeRecoveryChallengeToken(payload);
    throw new Error(RECOVERY_OTP_UNAVAILABLE_ERROR);
  }
}

async function auditRecoveryOtpFailure(
  payload: ChallengePayload,
  deviceFingerprint: DeviceFingerprint | undefined,
  attemptCount: number,
  challengeLocked: boolean,
  reason: string,
): Promise<void> {
  await auditRecoveryEvent({
    eventType: "recovery_failed",
    userId: payload.userId,
    ip: deviceFingerprint?.ip,
    userAgent: deviceFingerprint?.userAgent,
    details: {
      reason,
      attemptCount,
      challengeLocked,
    },
    risk: challengeLocked ? "high" : "medium",
  });
}

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
export async function unlockApp(params: UnlockAppParams): Promise<UnlockAppResult> {
  const { identifier, passcode, deviceFingerprint } = params;
  const trimmed = identifier.trim().toLowerCase();
  const isEmail = trimmed.includes("@") && trimmed.includes(".");
  const isPhone = /^\+[0-9]{10,15}$/.test(identifier.trim());

  const where = isEmail ? { email: trimmed } : isPhone ? { phoneE164: identifier.trim() } : null;
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
      identifier: "***",
    });
    throw new Error("User not found or recovery not enabled");
  }

  // Check rate limits BEFORE any verification
  const rateLimitResult = await checkRecoveryRateLimit(identifier, user.id, deviceFingerprint.ip);

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
  const deviceRateLimited = await isDeviceRateLimited(user.id, deviceFingerprint);
  if (deviceRateLimited) {
    await recordRecoveryAttempt(
      user.id,
      identifier,
      false,
      "Device rate limited",
      deviceFingerprint.ip,
      deviceFingerprint.userAgent,
    );

    throw new Error("Too many attempts from this device. Please try again later.");
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
  const otpChallenge = await prisma.otpChallenge.create({
    data: {
      userId: user.id,
      codeHash,
      channel,
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
    },
  });

  await publishOtpToQueue({ channel, to, code });

  const challenge_token = otpChallenge?.id
    ? signChallengeToken(user.id, { otpChallengeId: otpChallenge.id })
    : signChallengeToken(user.id);

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
  let payload: ChallengePayload;

  try {
    payload = await verifyChallengeToken(challenge_token, { consumeJti: false });
    if (
      !payload ||
      typeof payload.userId !== "string" ||
      payload.userId.length === 0 ||
      (payload.otpChallengeId !== undefined && typeof payload.otpChallengeId !== "string")
    ) {
      throw new Error("Invalid challenge");
    }
  } catch {
    throw new Error("Invalid or expired challenge");
  }

  const now = new Date();
  let challenge: { id: string; codeHash: string } | null;
  try {
    challenge = await prisma.otpChallenge.findFirst({
      where: {
        ...(payload.otpChallengeId ? { id: payload.otpChallengeId } : {}),
        userId: payload.userId,
        expiresAt: { gt: now },
        usedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
  } catch {
    logger.error("Recovery: OTP challenge lookup unavailable", {
      userId: payload.userId,
    });
    await revokeRecoveryChallengeToken(payload);
    throw new Error(RECOVERY_OTP_UNAVAILABLE_ERROR);
  }

  if (!challenge) {
    await revokeRecoveryChallengeToken(payload);
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

  const ip = deviceFingerprint?.ip || "unknown";
  const attemptKey = getRecoveryOtpAttemptKey(challenge_token);
  let rateLimitResult: RecoveryRateLimitResult;
  try {
    rateLimitResult = await checkRecoveryRateLimit(
      attemptKey,
      payload.userId,
      ip,
      RECOVERY_OTP_ATTEMPT_PREFIX,
    );
  } catch {
    logger.error("Recovery: OTP rate-limit store unavailable", {
      userId: payload.userId,
      hasIp: Boolean(deviceFingerprint?.ip),
    });
    await revokeRecoveryChallengeToken(payload);
    throw new Error(RECOVERY_OTP_UNAVAILABLE_ERROR);
  }

  const attemptCount = getRecoveryChallengeAttemptCount(rateLimitResult.remainingAttempts);
  const challengeLocked = attemptCount >= RECOVERY_OTP_MAX_ATTEMPTS;

  if (!rateLimitResult.allowed) {
    await markRecoveryChallengeUsed(payload, challenge.id, now);
    await revokeRecoveryChallengeToken(payload);
    await auditRecoveryOtpFailure(
      payload,
      deviceFingerprint,
      RECOVERY_OTP_MAX_ATTEMPTS,
      true,
      "OTP verification rate limited",
    );
    logger.warn("Recovery: OTP verification rate limited", {
      userId: payload.userId,
      hasIp: Boolean(deviceFingerprint?.ip),
      attemptCount: RECOVERY_OTP_MAX_ATTEMPTS,
      challengeLocked: true,
    });
    throw new Error(RECOVERY_OTP_LOCKOUT_ERROR);
  }

  const rejectOtp = async (): Promise<never> => {
    await recordRecoveryOtpAttempt(
      payload,
      attemptKey,
      false,
      `${RECOVERY_OTP_ATTEMPT_PREFIX}:invalid`,
      deviceFingerprint,
    );

    if (challengeLocked) {
      await markRecoveryChallengeUsed(payload, challenge.id, now);
      await revokeRecoveryChallengeToken(payload);
    }

    await auditRecoveryOtpFailure(
      payload,
      deviceFingerprint,
      attemptCount,
      challengeLocked,
      "Invalid OTP",
    );
    logger.warn("Recovery: invalid OTP", {
      userId: payload.userId,
      hasIp: Boolean(deviceFingerprint?.ip),
      attemptCount,
      challengeLocked,
    });
    throw new Error(challengeLocked ? RECOVERY_OTP_LOCKOUT_ERROR : "Invalid code");
  };

  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return rejectOtp();
  }

  let match: boolean;
  try {
    match = await bcrypt.compare(code, challenge.codeHash);
  } catch {
    await recordRecoveryOtpAttempt(
      payload,
      attemptKey,
      false,
      `${RECOVERY_OTP_ATTEMPT_PREFIX}:verification_error`,
      deviceFingerprint,
    );
    if (challengeLocked) {
      await markRecoveryChallengeUsed(payload, challenge.id, now);
      await revokeRecoveryChallengeToken(payload);
    }
    logger.error("Recovery: OTP verification dependency unavailable", {
      userId: payload.userId,
      hasIp: Boolean(deviceFingerprint?.ip),
      attemptCount,
    });
    throw new Error(RECOVERY_OTP_UNAVAILABLE_ERROR);
  }

  if (!match) {
    return rejectOtp();
  }

  await recordRecoveryOtpAttempt(
    payload,
    attemptKey,
    true,
    `${RECOVERY_OTP_ATTEMPT_PREFIX}:success`,
    deviceFingerprint,
  );
  await markRecoveryChallengeUsed(payload, challenge.id, now);
  await revokeRecoveryChallengeToken(payload);

  await rotateUserSessions(payload.userId);

  const apiKey = await generateApiKey(payload.userId, []);

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

  await auditRecoveryEvent({
    eventType: "recovery_completed",
    userId: payload.userId,
    ip: deviceFingerprint?.ip,
    userAgent: deviceFingerprint?.userAgent,
    details: {
      apiKeyGenerated: true,
      sessionsRotated: true,
      deviceTrusted: trust_device,
      otpAttemptCount: attemptCount,
    },
    risk: "medium",
  });

  logger.info("Recovery: OTP verified, new key issued, sessions rotated", {
    userId: payload.userId,
    sessionsRotated: true,
    attemptCount,
  });

  return {
    api_key: apiKey,
    user_id: payload.userId,
  };
}
