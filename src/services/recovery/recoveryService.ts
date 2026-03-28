/**
 * Recovery Tier 1: unlock app via email/phone + passcode + OTP.
 * Two-step flow: 1) verify passcode, send OTP; 2) verify OTP, issue API key.
 */
import bcrypt from "bcryptjs";
import { prisma } from "../../config/database";
import { generateApiKey } from "../../middleware/auth";
import { logger } from "../../config/logger";
import { signChallengeToken, verifyChallengeToken } from "../../utils/jwt";
import { getRabbitMQChannel, QUEUES } from "../../config/rabbitmq";

const OTP_EXPIRY_MINUTES = 10;

export interface UnlockAppParams {
  identifier: string; // email or E.164 phone
  passcode: string;
}

export interface UnlockAppResult {
  challenge_token: string;
  channel: "email" | "sms";
}

export interface VerifyRecoveryOtpParams {
  challenge_token: string;
  code: string;
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
 * Step 1: Verify identifier + passcode, generate OTP, return challenge token.
 */
export async function unlockApp(
  params: UnlockAppParams,
): Promise<UnlockAppResult> {
  const { identifier, passcode } = params;
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

  const match = await bcrypt.compare(passcode, user.passcodeHash);
  if (!match) {
    logger.warn("Recovery: invalid passcode", { userId: user.id });
    throw new Error("Invalid passcode");
  }

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
  logger.info("Recovery: passcode verified, OTP sent", {
    userId: user.id,
    channel,
  });

  return { challenge_token, channel };
}

/**
 * Step 2: Verify challenge token + OTP code, issue API key.
 */
export async function verifyRecoveryOtp(
  params: VerifyRecoveryOtpParams,
): Promise<VerifyRecoveryOtpResult> {
  const { challenge_token, code } = params;
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
    throw new Error("Invalid or expired code");
  }

  const match = await bcrypt.compare(code, challenge.codeHash);
  if (!match) {
    logger.warn("Recovery: invalid OTP", { userId: payload.userId });
    throw new Error("Invalid code");
  }

  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: { usedAt: now },
  });

  const apiKey = await generateApiKey(payload.userId, []);
  logger.info("Recovery: OTP verified, new key issued", {
    userId: payload.userId,
  });

  return {
    api_key: apiKey,
    user_id: payload.userId,
  };
}
