/**
 * Signin: identifier (username/email/phone) + passcode.
 * Signup: username + passcode (simple account creation; no email).
 * If 2FA enabled, returns challenge_token (JWT); else issues api_key.
 * OTP (sms/email) is created and published to RabbitMQ OTP_SEND for delivery.
 */
import bcrypt from "bcryptjs";
import { totp } from "otplib";
import { prisma } from "../../config/database";
import { generateApiKey } from "../../middleware/auth";
import { signChallengeToken, verifyChallengeToken } from "../../utils/jwt";
import { logger } from "../../config/logger";
import { getRabbitMQChannel } from "../../config/rabbitmq";
import { QUEUES } from "../../config/rabbitmq";
import { ensureWalletForUser } from "../wallet/walletService";
import { logAudit } from "../audit";

import * as crypto from "crypto";

/** Placeholder Stellar address until wallet is created on first signin. Schema: 56 chars, unique. */
function getPlaceholderStellarAddress(): string {
  return ("P" + crypto.randomBytes(28).toString("hex")).slice(0, 56);
}

export interface SignupParams {
  username: string;
  passcode: string;
}

export interface SignupResult {
  user_id: string;
  message: string;
}

export interface SigninParams {
  identifier: string; // username (with/without @), email, or E.164 phone
  passcode: string;
}

export type SigninResult =
  | { requires_2fa: true; challenge_token: string }
  | {
      api_key: string;
      user_id: string;
      wallet_created?: boolean;
      passphrase?: string;
      encryption_method_required?: boolean;
    };

export interface Verify2faParams {
  challenge_token: string;
  code: string;
}

export interface Verify2faResult {
  api_key: string;
  user_id: string;
  wallet_created?: boolean;
  passphrase?: string;
  encryption_method_required?: boolean;
}

const OTP_EXPIRY_MINUTES = 10;

function normalizeIdentifier(s: string): {
  kind: "username" | "email" | "phone";
  value: string;
} {
  const trimmed = (s || "").trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("@")) {
    return { kind: "username", value: lower.slice(1).replace(/\s/g, "") };
  }
  if (trimmed.startsWith("+") && /^\+[0-9]{10,15}$/.test(trimmed)) {
    return { kind: "phone", value: trimmed };
  }
  if (trimmed.includes("@") && trimmed.includes(".")) {
    return { kind: "email", value: lower };
  }
  return { kind: "username", value: lower.replace(/\s/g, "") };
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
    logger.debug("OTP published to queue", {
      channel: payload.channel,
      to: payload.to ? "***" : undefined,
    });
  } catch (e) {
    logger.error("Failed to publish OTP to RabbitMQ", e);
    throw new Error("OTP delivery unavailable");
  }
}

/**
 * Resolve identifier to user (username, email, or E.164 phone).
 */
export async function resolveUserByIdentifier(identifier: string) {
  const { kind, value } = normalizeIdentifier(identifier);
  const where =
    kind === "username"
      ? { username: value }
      : kind === "phone"
        ? { phoneE164: value }
        : { email: value };
  return prisma.user.findFirst({
    where,
    select: {
      id: true,
      passcodeHash: true,
      twoFaMethod: true,
    },
  });
}

/**
 * Simple account creation: username + passcode. No email. Stellar wallet is created on first signin.
 */
export async function signup(params: SignupParams): Promise<SignupResult> {
  const username = (params.username || "")
    .trim()
    .toLowerCase()
    .replace(/\s/g, "");
  if (!username || username.length > 64) {
    throw new Error("Username is required and must be at most 64 characters");
  }
  if (
    !params.passcode ||
    params.passcode.length < 4 ||
    params.passcode.length > 64
  ) {
    throw new Error("Passcode must be 4–64 characters");
  }
  const existing = await prisma.user.findFirst({
    where: { username },
    select: { id: true },
  });
  if (existing) {
    throw new Error("Username already taken");
  }
  const passcodeHash = await bcrypt.hash(params.passcode, 10);
  const user = await prisma.user.create({
    data: {
      username,
      passcodeHash,
      stellarAddress: getPlaceholderStellarAddress(),
    },
    select: { id: true },
  });
  await logAudit({
    eventType: "auth",
    entityType: "user",
    entityId: user.id,
    action: "signup",
    performedBy: user.id,
  });
  logger.info("Signup: user created", { userId: user.id, username });
  return {
    user_id: user.id,
    message: "Account created. Sign in with your username and passcode.",
  };
}

/**
 * Signin: verify identifier + passcode. If 2FA on, return challenge_token (and send OTP via RabbitMQ when sms/email); else issue api_key.
 */
export async function signin(params: SigninParams): Promise<SigninResult> {
  const { identifier, passcode } = params;
  const user = await resolveUserByIdentifier(identifier);
  if (!user || !user.passcodeHash) {
    logger.warn("Signin: user not found or no passcode", {
      identifier:
        identifier.includes("@") && identifier.includes(".")
          ? "***"
          : identifier.slice(0, 6) + "***",
    });
    throw new Error("Invalid credentials");
  }

  const match = await bcrypt.compare(passcode, user.passcodeHash);
  if (!match) {
    logger.warn("Signin: invalid passcode", { userId: user.id });
    throw new Error("Invalid credentials");
  }

  if (user.twoFaMethod) {
    if (user.twoFaMethod === "sms" || user.twoFaMethod === "email") {
      const u = await prisma.user.findUnique({
        where: { id: user.id },
        select: { email: true, phoneE164: true },
      });
      const to = user.twoFaMethod === "email" ? u?.email : u?.phoneE164;
      if (!to) throw new Error("2FA channel not configured");
      const code = generateOtpCode();
      const codeHash = await bcrypt.hash(code, 10);
      await prisma.otpChallenge.create({
        data: {
          userId: user.id,
          codeHash,
          channel: user.twoFaMethod,
          expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
        },
      });
      await publishOtpToQueue({ channel: user.twoFaMethod, to, code });
    }
    const challenge_token = signChallengeToken(user.id);
    await logAudit({
      eventType: "auth",
      entityType: "user",
      entityId: user.id,
      action: "signin_2fa_required",
      performedBy: user.id,
    });
    logger.info("Signin: 2FA required", {
      userId: user.id,
      method: user.twoFaMethod,
    });
    return { requires_2fa: true, challenge_token };
  }

  const api_key = await generateApiKey(user.id, []);
  const wallet = await ensureWalletForUser(user.id);
  await logAudit({
    eventType: "auth",
    entityType: "user",
    entityId: user.id,
    action: "signin_success",
    performedBy: user.id,
  });
  logger.info("Signin: success, API key issued", { userId: user.id });
  const out: {
    api_key: string;
    user_id: string;
    wallet_created?: boolean;
    passphrase?: string;
    encryption_method_required?: boolean;
  } = { api_key, user_id: user.id };
  if (wallet.wallet_created && wallet.passphrase) {
    out.wallet_created = true;
    out.passphrase = wallet.passphrase;
    out.encryption_method_required = true;
  }
  return out;
}

/**
 * Verify 2FA and issue api_key. challenge_token is JWT; code is TOTP or OTP.
 */
export async function verify2fa(
  params: Verify2faParams,
): Promise<Verify2faResult> {
  const { challenge_token, code } = params;
  const payload = verifyChallengeToken(challenge_token);
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, twoFaMethod: true, totpSecretEncrypted: true },
  });
  if (!user || !user.twoFaMethod)
    throw new Error("Invalid or expired challenge");

  if (user.twoFaMethod === "totp") {
    if (!user.totpSecretEncrypted) throw new Error("TOTP not configured");
    const valid = totp.check(code, user.totpSecretEncrypted);
    if (!valid) {
      logger.warn("Verify2FA: invalid TOTP", { userId: user.id });
      throw new Error("Invalid code");
    }
  } else if (user.twoFaMethod === "sms" || user.twoFaMethod === "email") {
    const now = new Date();
    const challenge = await prisma.otpChallenge.findFirst({
      where: {
        userId: user.id,
        channel: user.twoFaMethod,
        expiresAt: { gt: now },
        usedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
    if (!challenge) throw new Error("Invalid or expired code");
    const match = await bcrypt.compare(code, challenge.codeHash);
    if (!match) {
      logger.warn("Verify2FA: invalid OTP", { userId: user.id });
      throw new Error("Invalid code");
    }
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { usedAt: now },
    });
  } else {
    throw new Error("Unsupported 2FA method");
  }

  const api_key = await generateApiKey(user.id, []);
  const wallet = await ensureWalletForUser(user.id);
  await logAudit({
    eventType: "auth",
    entityType: "user",
    entityId: user.id,
    action: "verify_2fa_success",
    performedBy: user.id,
  });
  logger.info("Verify2FA: success, API key issued", { userId: user.id });
  const out: {
    api_key: string;
    user_id: string;
    wallet_created?: boolean;
    passphrase?: string;
    encryption_method_required?: boolean;
  } = { api_key, user_id: user.id };
  if (wallet.wallet_created && wallet.passphrase) {
    out.wallet_created = true;
    out.passphrase = wallet.passphrase;
    out.encryption_method_required = true;
  }
  return out;
}
